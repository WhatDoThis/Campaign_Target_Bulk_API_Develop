/* ============================================================================
 * TBAWFactory / 01_WorkerDistributor (큐 키 offset 분할 + PostEvent)
 * ============================================================================
 * pending 을 @ingestYm, @lineNo 오름차순으로 두고, 가장 앞 월의 앞 remaining 건을
 * TBAW1..n 에 나눈다. 한 라운드에 월을 섞지 않음. skip 워커도 Option 을 남긴다.
 *
 * PostEvent vars: workerName, ingestYm, lineStart, lineEnd, runId, optKey,
 *   workerCount(실발사 수. skip 반영 — 스로틀용)
 * batchSize·dryRun·토큰·CUSTOM_ATTR 은 워커가 BULK_CFG 에서 읽는다.
 * complete 인자는 반드시 false.
 *
 * [Main Functions]
 * 1. pending 첫 큐 행 확인, 그달 앞 N건 상한
 * 2. offset 분할 — 같은 월 정렬 목록, 닫힌 lineNo 구간
 * 3. 워커 WF 시작 확인(state=11) + PostEvent
 *
 * [Dependencies]
 * xtk.queryDef, xtk.workflow.PostEvent, setOption
 * ==========================================================================*/

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

if (String(instance.vars.nextAction) === "finish") {
  logInfo("[Distributor] finish 상태 — 분배 생략");
} else {

var SCHEMA     = String(instance.vars.MEMBER_SCHEMA);
var ELEMENT    = String(instance.vars.MEMBER_ELEMENT);
var COND       = String(instance.vars.PENDING_COND);
var W_COUNT    = NUM(instance.vars.WORKER_COUNT, 5);
var ROUND_LIMIT= NUM(instance.vars.ROUND_LIMIT, 5000000);
var GRAND_TOTAL= NUM(instance.vars.GRAND_TOTAL, 0);
var OPT_PREFIX = String(instance.vars.OPT_PREFIX);
var EXACT      = (String(instance.vars.EXACT_COUNT) === "true");
var SIG        = String(instance.vars.WORKER_SIG || "sigWorker");
var STAGGER    = NUM(instance.vars.STAGGER_POST_MS, 0);

var round     = NUM(instance.vars.round) + 1;
var processed = NUM(instance.vars.globalProcessed);
instance.vars.round = round;
logInfo("===== [Distributor] Round " + round + " 시작 (누적 " + processed + "건) =====");

function sqlLit(s) {
  return String(s === undefined || s === null ? "" : s).replace(/'/g, "''");
}

function fetchRow(offset, cond) {
  var q = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select"
              startLine={String(offset)} lineCount="1">
      <select>
        <node expr="@membershipUid"/>
        <node expr="@ingestYm"/>
        <node expr="@lineNo"/>
      </select>
      <where><condition expr={cond}/></where>
      <orderBy>
        <node expr="@ingestYm" sortDesc="false"/>
        <node expr="@lineNo" sortDesc="false"/>
      </orderBy>
    </queryDef>
  ).ExecuteQuery();
  var row = { uid: "", ym: "", line: 0 };
  for each (var r in q[ELEMENT]) {
    row.uid  = String(r.@membershipUid);
    row.ym   = String(r.@ingestYm);
    row.line = parseInt(String(r.@lineNo), 10) || 0;
  }
  return row;
}

var head = fetchRow(0, COND);
if (head.uid === "" || head.line < 1 || head.ym.length !== 6) {
  logInfo("[Distributor] 처리 대상 없음 → finish (ym=" + head.ym + " line=" + head.line + ")");
  instance.vars.nextAction = "finish";
  instance.vars.roundSize = 0;
  instance.vars.activeWorkers = 0;
} else {

var limit = ROUND_LIMIT;
if (GRAND_TOTAL > 0) limit = Math.min(limit, GRAND_TOTAL - processed);
if (limit <= 0) {
  logInfo("[Distributor] 전체 상한(" + GRAND_TOTAL + ") 도달 → finish");
  instance.vars.nextAction = "finish";
  instance.vars.roundSize = 0;
  instance.vars.activeWorkers = 0;
} else {

var condYm = COND + " AND @ingestYm = '" + sqlLit(head.ym) + "'";
var remaining = limit;
if (EXACT) {
  var c = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="count">
      <where><condition expr={condYm}/></where>
    </queryDef>
  ).ExecuteQuery();
  remaining = Math.min(limit, NUM(c.@count, 0));
  logInfo("[Distributor] 그달 미전송 건수(정확): " + NUM(c.@count, 0));
}

logInfo("[Distributor] 이번 월=" + head.ym + " 최소 line=" + head.line
  + " uid=" + head.uid + " / 앞 " + remaining + "건");

var runId  = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S") + "R" + round;
var bounds = [];
var perOff = Math.ceil(remaining / W_COUNT);
var marks = [], mi;
for (mi = 0; mi < W_COUNT; mi++) {
  var off = mi * perOff;
  if (off >= remaining) break;
  marks.push(off);
}
marks.push(remaining - 1);
var b;
for (b = 0; b < marks.length - 1; b++) {
  var sRow = fetchRow(marks[b], condYm);
  var endOff = (b === marks.length - 2) ? marks[b + 1] : (marks[b + 1] - 1);
  var eRow = fetchRow(endOff, condYm);
  if (sRow.line < 1 || eRow.line < 1) {
    logWarning("[Distributor] offset 경계 공백 start=" + marks[b] + " end=" + endOff
      + " — 그달 pending 이 remaining 보다 적거나 OFFSET 조회 실패");
    continue;
  }
  bounds.push({ ym: head.ym, s: sRow.line, e: eRow.line, su: sRow.uid, eu: eRow.uid });
}

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
  jobs.push({
    name: wName, wf: wWf, key: optKey,
    ym: bounds[w].ym, s: bounds[w].s, e: bounds[w].e,
    su: bounds[w].su, eu: bounds[w].eu
  });
}

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
        ingestYm={job.ym}
        lineStart={String(job.s)}
        lineEnd={String(job.e)}
        runId={runId}
        optKey={job.key}
        workerCount={String(fireN)}/>,
      false
    );
    active++;
    names.push(job.name);
    logInfo("  " + job.name + " → " + job.wf + "/" + SIG + " : "
      + job.ym + " line " + job.s + " ~ " + job.e
      + " (" + job.su + " ~ " + job.eu + ")");
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
} // head
} // nextAction
