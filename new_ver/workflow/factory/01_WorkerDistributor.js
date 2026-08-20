/* ============================================================================
 * TBAWFactory / 01_WorkerDistributor (UID 분할 + PostEvent)
 * ============================================================================
 * 미전송 min/max 를 SQL 로 읽고 arith 로 TBAW1..n 에 닫힌 구간을 나눈다.
 * 구간은 겹치지 않음. skip 워커도 Option 을 남겨 이전 라운드 done 잔존을 막는다.
 *
 * PostEvent vars: workerName, uidStart, uidEnd, runId, optKey,
 *   batchSize, dryRun, workerCount(실발사 수), customAttr, authToken
 * complete 인자는 반드시 false. true 면 대상 WF 가 끝나 다음 시그널을 못 받는다.
 *
 * [Main Functions]
 * 1. UID 변환·min/max 조회 (SQL, 실패 시 queryDef)
 * 2. arith/offset 분할 — 닫힌 구간, 겹침 없음
 * 3. 워커 WF 시작 확인(state=11) + PostEvent
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js, xtk.queryDef, xtk.workflow.PostEvent, setOption
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

// 00 ENABLED=false 또는 이전 라운드가 상한/무대상 finish 면 분배하지 않는다.
if (String(instance.vars.nextAction) === "finish") {
  logInfo("[Distributor] finish 상태 — 분배 생략");
} else {

var SCHEMA     = String(instance.vars.MEMBER_SCHEMA);
var ELEMENT    = String(instance.vars.MEMBER_ELEMENT);
var COND       = String(instance.vars.PENDING_COND);
var W_COUNT    = NUM(instance.vars.WORKER_COUNT, 5);
var BATCH_SIZE = NUM(instance.vars.BATCH_SIZE, 5000);
var ROUND_LIMIT= NUM(instance.vars.ROUND_LIMIT, 25000);
var GRAND_TOTAL= NUM(instance.vars.GRAND_TOTAL, 0);
var MODE       = String(instance.vars.PARTITION_MODE || "arith");
var UID_PREFIX = String(instance.vars.UID_PREFIX);
var UID_DIGITS = NUM(instance.vars.UID_DIGITS, 9);
var OPT_PREFIX = String(instance.vars.OPT_PREFIX);
var EXACT      = (String(instance.vars.EXACT_COUNT) === "true");
var SIG        = String(instance.vars.WORKER_SIG || "sigWorker");
var DRY        = String(instance.vars.DRY_RUN || "false");
var CUSTOM     = String(instance.vars.CUSTOM_ATTR || "");
var STAGGER    = NUM(instance.vars.STAGGER_POST_MS, 0);

var round     = NUM(instance.vars.round) + 1;
var processed = NUM(instance.vars.globalProcessed);
instance.vars.round = round;
logInfo("===== [Distributor] Round " + round + " 시작 (누적 " + processed + "건) =====");

// # 1. [UID]
// uidToNum / numToUid: prefix 뒤 숫자만 산술. 패딩 길이는 UID_DIGITS.
function uidToNum(uid) { return parseInt(String(uid).substring(UID_PREFIX.length), 10) || 0; }
function numToUid(n) {
  var s = String(n);
  while (s.length < UID_DIGITS) s = "0" + s;
  return UID_PREFIX + s;
}

// edgeUidSql: 5천만 건에서 queryDef sortDesc max 가 빈 값을 줄 수 있어 SQL 우선.
//   물리 컬럼: smembershipuid, sapiyn (Campaign 매핑). 테이블은 BULK_CFG.MEMBER_TABLE
function edgeUidSql(agg) {
  var tbl = String(instance.vars.MEMBER_TABLE || "WootarTestWooTargetSample");
  return String(sqlGetString(
    "SELECT " + agg + "(smembershipuid) FROM " + tbl
      + " WHERE sapiyn='N' OR sapiyn IS NULL"
  ) || "");
}

// fetchUid: SQL 실패 시 폴백. offset 모드의 경계 조회에도 사용.
//   desc=true 는 max. lineCount=1 + orderBy membershipUid
function fetchUid(offset, desc) {
  var q = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select"
              startLine={String(offset)} lineCount="1">
      <select><node expr="@membershipUid"/></select>
      <where><condition expr={COND}/></where>
      <orderBy><node expr="@membershipUid" sortDesc={desc ? "true" : "false"}/></orderBy>
    </queryDef>
  ).ExecuteQuery();
  var uid = "";
  for each (var r in q[ELEMENT]) uid = String(r.@membershipUid);
  return uid;
}

var minUid = "", maxUid = "";
try { minUid = edgeUidSql("min"); maxUid = edgeUidSql("max"); }
catch (eSql) {
  logWarning("[Distributor] min/max SQL 실패 → queryDef: " + eSql.toString());
  minUid = fetchUid(0, false);
  maxUid = fetchUid(0, true);
}

if (minUid === "") {
  logInfo("[Distributor] 처리 대상 없음 → finish");
  instance.vars.nextAction = "finish";
  instance.vars.roundSize = 0;
  instance.vars.activeWorkers = 0;
} else {

// 이번 라운드 UID 폭: ROUND_LIMIT 와 GrandTotal 잔여 중 작은 쪽.
var limit = ROUND_LIMIT;
if (GRAND_TOTAL > 0) limit = Math.min(limit, GRAND_TOTAL - processed);
if (limit <= 0) {
  logInfo("[Distributor] 전체 상한(" + GRAND_TOTAL + ") 도달 → finish");
  instance.vars.nextAction = "finish";
  instance.vars.roundSize = 0;
  instance.vars.activeWorkers = 0;
} else {

var remaining = limit;
if (EXACT) {
  var c = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="count">
      <where><condition expr={COND}/></where>
    </queryDef>
  ).ExecuteQuery();
  remaining = Math.min(limit, NUM(c.@count, 0));
  logInfo("[Distributor] 미전송 건수(정확): " + NUM(c.@count, 0));
}

logInfo("[Distributor] 대상 " + minUid + " ~ " + maxUid + " / 라운드 상한 " + remaining);

// # 2. [Partition]
// runId: 전 워커 동일. Option STRICT 와 Master.runId 가 이 값을 본다.
var runId  = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S") + "R" + round;
var bounds = [];
var minNum = uidToNum(minUid);
var maxNum = uidToNum(maxUid);

if (MODE === "offset") {
  // 정렬된 pending 목록의 offset 으로 경계를 찍는다. 공백 UID 에 안전, 조회는 워커 수+1회.
  var perOff = Math.ceil(remaining / W_COUNT);
  var marks = [], m;
  for (m = 0; m < W_COUNT; m++) {
    var off = m * perOff;
    if (off >= remaining) break;
    marks.push(off);
  }
  marks.push(remaining - 1);
  var b;
  for (b = 0; b < marks.length - 1; b++) {
    var sUid = fetchUid(marks[b], false);
    // 다음 워커 start 직전 UID 가 이 워커 end. 마지막은 remaining-1 위치.
    var eUid = (b === marks.length - 2)
             ? fetchUid(marks[marks.length - 1], false)
             : numToUid(uidToNum(fetchUid(marks[b + 1], false)) - 1);
    if (sUid === "" || eUid === "") continue;
    bounds.push({ s: sUid, e: eUid });
  }
} else {
  // arith: minUid 숫자부터 remaining 폭을 W_COUNT 등분. 닫힌 구간 [s,e], 다음 워커는 e+1.
  //   가드레일: UID 가 비연속이면 빈 구간이 생길 수 있음. 그때는 PARTITION=offset
  var endNum = Math.min(minNum + remaining - 1, maxNum);
  var span   = endNum - minNum + 1;
  var perW   = Math.ceil(span / W_COUNT);
  var bi;
  for (bi = 0; bi < W_COUNT; bi++) {
    var sN = minNum + (bi * perW);
    if (sN > endNum) break;
    var eN = Math.min(sN + perW - 1, endNum);
    bounds.push({ s: numToUid(sN), e: numToUid(eN) });
  }
}

// # 3. [Dispatch]
// wfStarted: 공식 감독 state 11=started, 13=pause, 20=stop.
//   미시작 WF 에 PostEvent 하면 예외 없이 큐에만 쌓일 수 있어 skip 으로 남긴다.
function wfStarted(internalName) {
  try {
    var wf = xtk.queryDef.create(
      <queryDef schema="xtk:workflow" operation="getIfExists">
        <select><node expr="@id"/><node expr="@state"/></select>
        <where><condition expr={"@internalName = '" + internalName + "'"}/></where>
      </queryDef>).ExecuteQuery();
    var id = parseInt(wf.@id, 10) || 0;
    var st = parseInt(wf.@state, 10);
    return (id > 0 && st === 11);
  } catch (eWf) {
    logWarning("[Distributor] WF 조회 실패 " + internalName + ": " + eWf.toString());
    return false;
  }
}

// 토큰은 BULK_CFG 에서만. 로그에 값을 찍지 않는다.
var authTok = "";
try { authTok = String(BULK_CFG.AUTH_TOKEN || ""); } catch (eA) { authTok = ""; }

// 1차: 할당·WF 상태 확인. skip 도 Option 기록 (이전 라운드 done 잔존 방지).
var jobs = [];
var w;
for (w = 0; w < W_COUNT; w++) {
  var wName = String(instance.vars.WORKER_NAME_TPL).replace("{n}", String(w + 1));
  var wWf   = String(instance.vars.WORKER_WF_TPL).replace("{n}", String(w + 1));
  var optKey= OPT_PREFIX + wName;
  if (w >= bounds.length) {
    setOption(optKey, runId + "|skip", "bulk worker status");
    logInfo("  " + wName + " : 할당 없음 (skip)");
    continue;
  }
  if (!wfStarted(wWf)) {
    setOption(optKey, runId + "|skip", "bulk worker status");
    logWarning("  " + wName + " : " + wWf + " 미시작(state≠11) → skip. Start 후 재실행");
    continue;
  }
  jobs.push({ name: wName, wf: wWf, key: optKey, s: bounds[w].s, e: bounds[w].e });
}

// 2차: 실발사 수(fireN)를 workerCount 로 넣어 스로틀이 실제 동시 HTTP 에 맞게 계산되게 한다.
var fireN = jobs.length;
var active = 0;
var names  = [];
var j;
for (j = 0; j < fireN; j++) {
  var job = jobs[j];
  setOption(job.key, runId + "|ready", "bulk worker status");
  try {
    if (STAGGER > 0 && j > 0) sleep(STAGGER);
    xtk.workflow.PostEvent(
      job.wf, SIG, "",
      <variables
        workerName={job.name}
        uidStart={job.s}
        uidEnd={job.e}
        runId={runId}
        optKey={job.key}
        batchSize={String(BATCH_SIZE)}
        dryRun={DRY}
        workerCount={String(fireN)}
        customAttr={CUSTOM}
        authToken={authTok}/>,
      false
    );
    active++;
    names.push(job.name);
    logInfo("  " + job.name + " → " + job.wf + "/" + SIG + " : " + job.s + " ~ " + job.e);
  } catch (ePe) {
    setOption(job.key, runId + "|error", "bulk worker status");
    logError("  " + job.name + " PostEvent 실패: " + (ePe.message || ePe.toString()));
  }
}

instance.vars.runId          = runId;
instance.vars.activeWorkers  = active;
instance.vars.workerNames    = names.join(",");
instance.vars.roundSize      = remaining;
instance.vars.pollCount      = 0;
instance.vars.nextAction     = (active === 0) ? "finish" : "working";
for (var rr = 1; rr <= W_COUNT; rr++) instance.vars["readyRetry_" + rr] = 0;

if (active === 0) {
  logWarning("[Distributor] 트리거된 워커 없음 → finish");
} else {
  logInfo("[Distributor] Round " + round + " 발사 " + active + "개 / runId=" + runId
    + " / dryRun=" + DRY + " / workerCount=" + fireN);
}

} // limit
} // minUid
} // nextAction
