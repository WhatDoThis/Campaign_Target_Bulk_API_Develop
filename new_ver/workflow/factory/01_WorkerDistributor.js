/* ============================================================================
 * TBAWFactory / 01_WorkerDistributor (UID 오름차순 offset 분할 + PostEvent)
 * ============================================================================
 * pending 을 @membershipUid 오름차순으로 두고 앞 remaining 건을 TBAW1..n 에 나눈다.
 * UID 숫자 패딩을 가정하지 않음. 복잡한 고객번호도 같은 정렬.
 * skip 워커도 Option 을 남겨 이전 라운드 done 잔존을 막는다.
 *
 * PostEvent vars: workerName, uidStart, uidEnd, runId, optKey,
 *   batchSize, dryRun=false, workerCount(실발사 수), customAttr, authToken
 * complete 인자는 반드시 false. true 면 대상 WF 가 끝나 다음 시그널을 못 받는다.
 *
 * [Main Functions]
 * 1. pending 첫 UID 존재 확인, 앞 N건 상한
 * 2. offset 분할 — 정렬 목록 위치, 닫힌 구간, 겹침 없음
 * 3. 워커 WF 시작 확인(state=11) + PostEvent
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js, xtk.queryDef, xtk.workflow.PostEvent, setOption
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

// 02 가 상한/무대상으로 finish 를 남긴 뒤에도 00→01 선이 있으면 분배하지 않는다.
if (String(instance.vars.nextAction) === "finish") {
  logInfo("[Distributor] finish 상태 — 분배 생략");
} else {

var SCHEMA     = String(instance.vars.MEMBER_SCHEMA);
var ELEMENT    = String(instance.vars.MEMBER_ELEMENT);
var COND       = String(instance.vars.PENDING_COND);
var W_COUNT    = NUM(instance.vars.WORKER_COUNT, 5);
var BATCH_SIZE = NUM(instance.vars.BATCH_SIZE, 5000);
var ROUND_LIMIT= NUM(instance.vars.ROUND_LIMIT, 5000000);
var GRAND_TOTAL= NUM(instance.vars.GRAND_TOTAL, 0);
var OPT_PREFIX = String(instance.vars.OPT_PREFIX);
var EXACT      = (String(instance.vars.EXACT_COUNT) === "true");
var SIG        = String(instance.vars.WORKER_SIG || "sigWorker");
var CUSTOM     = String(instance.vars.CUSTOM_ATTR || "");
var STAGGER    = NUM(instance.vars.STAGGER_POST_MS, 0);

var round     = NUM(instance.vars.round) + 1;
var processed = NUM(instance.vars.globalProcessed);
instance.vars.round = round;
logInfo("===== [Distributor] Round " + round + " 시작 (누적 " + processed + "건) =====");

// # 1. [UID]
// fetchUid: pending 을 membershipUid 오름차순으로 두고 startLine 번째 1건.
//   startLine=0 이 가장 낮은 UID. 숫자 패딩/prefix 변환 없음.
function fetchUid(offset) {
  var q = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select"
              startLine={String(offset)} lineCount="1">
      <select><node expr="@membershipUid"/></select>
      <where><condition expr={COND}/></where>
      <orderBy><node expr="@membershipUid" sortDesc="false"/></orderBy>
    </queryDef>
  ).ExecuteQuery();
  var uid = "";
  for each (var r in q[ELEMENT]) uid = String(r.@membershipUid);
  return uid;
}

var minUid = fetchUid(0);
if (minUid === "") {
  logInfo("[Distributor] 처리 대상 없음 → finish");
  instance.vars.nextAction = "finish";
  instance.vars.roundSize = 0;
  instance.vars.activeWorkers = 0;
} else {

// 이번 라운드 행 수: ROUND_LIMIT 와 GrandTotal 잔여 중 작은 쪽.
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

logInfo("[Distributor] pending 최소 UID=" + minUid + " / 이번 라운드 앞 " + remaining + "건 (오름차순)");

// # 2. [Partition]
// 정렬된 pending 목록의 offset 으로 닫힌 구간 [s,e] 를 찍는다.
//   다음 워커 start 직전 행이 이 워커 end. UID-1 산술 없음 (복잡한 고객번호 대응).
var runId  = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S") + "R" + round;
var bounds = [];
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
  var sUid = fetchUid(marks[b]);
  var endOff = (b === marks.length - 2) ? marks[b + 1] : (marks[b + 1] - 1);
  var eUid = fetchUid(endOff);
  if (sUid === "" || eUid === "") {
    logWarning("[Distributor] offset 경계 공백 start=" + marks[b] + " end=" + endOff
      + " — pending 이 remaining 보다 적거나 OFFSET 조회 실패");
    continue;
  }
  bounds.push({ s: sUid, e: eUid });
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
        dryRun="false"
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
    + " / workerCount=" + fireN);
}

} // limit
} // minUid
} // nextAction
