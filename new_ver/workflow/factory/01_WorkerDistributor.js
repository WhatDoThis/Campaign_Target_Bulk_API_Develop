/* ============================================================================
 * TBAWFactory / 01_WorkerDistributor (NTILE 분할 + PostEvent)
 * ============================================================================
 * pending @apiYn='N' 을 NTILE 로 워커 구간 분할. OFFSET 대용량 스캔 제거.
 *
 * PostEvent vars: workerName, ingestYm, lineStart, lineEnd, runId, optKey, workerCount
 *
 * [Main Functions]
 * 1. pending 첫 행·remaining 상한
 * 2. sqlSelect NTILE 경계
 * 3. 워커 WF PostEvent
 *
 * [Dependencies]
 * sqlSelect, xtk.workflow.PostEvent, setOption
 * ==========================================================================*/

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

if (String(instance.vars.nextAction) === "finish") {
  logInfo("[Distributor] finish 상태 — 분배 생략");
} else {

var SCHEMA      = String(instance.vars.MEMBER_SCHEMA);
var ELEMENT     = String(instance.vars.MEMBER_ELEMENT);
var COND        = String(instance.vars.PENDING_COND);
var TABLE       = String(instance.vars.MEMBER_TABLE);
var W_COUNT     = NUM(instance.vars.WORKER_COUNT, 3);
var ROUND_LIMIT = NUM(instance.vars.ROUND_LIMIT, 50000000);
var GRAND_TOTAL = NUM(instance.vars.GRAND_TOTAL, 0);
var OPT_PREFIX  = String(instance.vars.OPT_PREFIX);
var SIG         = String(instance.vars.WORKER_SIG || "sigWorker");
var STAGGER     = NUM(instance.vars.STAGGER_POST_MS, 0);

var round     = NUM(instance.vars.round) + 1;
var processed = NUM(instance.vars.globalProcessed);
instance.vars.round = round;
logInfo("===== [Distributor] Round " + round + " 시작 (누적 sent " + processed + ") =====");

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

function fetchUidAtLine(ym, lineNo) {
  var q = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select" lineCount="1">
      <select><node expr="@membershipUid"/></select>
      <where>
        <condition expr={"@ingestYm='" + sqlLit(ym) + "' AND @lineNo=" + lineNo}/>
      </where>
    </queryDef>
  ).ExecuteQuery();
  for each (var r in q[ELEMENT]) return String(r.@membershipUid);
  return "";
}

// (변경) NTILE 단일 스캔. OFFSET 5천만 회피
function ntileBounds(ym, wCount, remaining) {
  if (!TABLE) throw new Error("[Distributor] MEMBER_TABLE 미설정");
  var sql = "SELECT MIN(t.ilineno) AS ls, MAX(t.ilineno) AS le, COUNT(*) AS cnt "
    + "FROM ("
    + "  SELECT s.ilineno, NTILE(" + wCount + ") OVER (ORDER BY s.ilineno) AS b"
    + "  FROM " + TABLE + " s"
    + "  WHERE s.sapiyn='N' AND s.singestym='" + sqlLit(ym) + "'"
    + "  ORDER BY s.ilineno"
    + "  LIMIT " + remaining
    + ") t GROUP BY t.b ORDER BY t.b";

  var bounds = [];
  var rs;
  try {
    rs = sqlSelect(sql, false);
  } catch (eSql) {
    throw new Error("[Distributor] NTILE sqlSelect 실패: " + (eSql.message || eSql));
  }

  if (rs && rs.row !== undefined) {
    for each (var row in rs.row) {
      var ls = parseInt(String(row.@ls || row.@LS || 0), 10) || 0;
      var le = parseInt(String(row.@le || row.@LE || 0), 10) || 0;
      var cnt = parseInt(String(row.@cnt || row.@CNT || 0), 10) || 0;
      if (ls >= 1 && le >= ls) {
        bounds.push({ ym: ym, s: ls, e: le, cnt: cnt });
      }
    }
  } else if (rs && rs.@ls !== undefined) {
    var ls2 = parseInt(String(rs.@ls), 10) || 0;
    var le2 = parseInt(String(rs.@le), 10) || 0;
    if (ls2 >= 1 && le2 >= ls2) {
      bounds.push({ ym: ym, s: ls2, e: le2, cnt: NUM(rs.@cnt, 0) });
    }
  }

  var bi;
  for (bi = 0; bi < bounds.length; bi++) {
    bounds[bi].su = fetchUidAtLine(ym, bounds[bi].s);
    bounds[bi].eu = fetchUidAtLine(ym, bounds[bi].e);
    logInfo("[Distributor] NTILE bucket " + (bi + 1) + " line "
      + bounds[bi].s + "~" + bounds[bi].e + " cnt=" + bounds[bi].cnt);
  }
  return bounds;
}

var head = fetchRow(0, COND);
if (head.uid === "" || head.line < 1 || head.ym.length !== 6) {
  logInfo("[Distributor] 처리 대상 없음 → finish");
  instance.vars.nextAction = "finish";
  instance.vars.roundSize = 0;
  instance.vars.activeWorkers = 0;
} else {

var limit = ROUND_LIMIT;
if (GRAND_TOTAL > 0) limit = Math.min(limit, GRAND_TOTAL - processed);
if (limit <= 0) {
  logInfo("[Distributor] GRAND_TOTAL 상한 도달 → finish");
  instance.vars.nextAction = "finish";
  instance.vars.roundSize = 0;
  instance.vars.activeWorkers = 0;
} else {

var remaining = limit;
logInfo("[Distributor] ym=" + head.ym + " head line=" + head.line
  + " / 이번 라운드 최대 " + remaining + "건");

var bounds = ntileBounds(head.ym, W_COUNT, remaining);
var runId  = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S") + "R" + round;

function wfStarted(internalName) {
  try {
    var wf = xtk.queryDef.create(
      <queryDef schema="xtk:workflow" operation="getIfExists">
        <select><node expr="@id"/><node expr="@state"/></select>
        <where><condition expr={"@internalName = '" + internalName + "'"}/></where>
      </queryDef>).ExecuteQuery();
    return (parseInt(wf.@id, 10) > 0 && parseInt(wf.@state, 10) === 11);
  } catch (eWf) {
    logWarning("[Distributor] WF 조회 실패 " + internalName);
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
    logWarning("  " + wName + " : " + wWf + " 미시작 → skip");
    continue;
  }
  jobs.push({
    name: wName, wf: wWf, key: optKey,
    ym: bounds[w].ym, s: bounds[w].s, e: bounds[w].e,
    su: bounds[w].su, eu: bounds[w].eu
  });
}

var fireN  = jobs.length;
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
    logInfo("  " + job.name + " → " + job.ym + " line " + job.s + "~" + job.e
      + " (" + job.su + "~" + job.eu + ")");
  } catch (ePe) {
    setOption(job.key, runId + "|error", "bulk worker status");
    logError("  " + job.name + " PostEvent 실패: " + (ePe.message || ePe));
  }
}

instance.vars.runId         = runId;
instance.vars.activeWorkers = active;
instance.vars.workerNames   = names.join(",");
instance.vars.roundSize     = remaining;
instance.vars.pollCount     = 0;
instance.vars.nextAction    = (active === 0) ? "finish" : "working";
for (var rr = 1; rr <= W_COUNT; rr++) instance.vars["readyRetry_" + rr] = 0;

if (active === 0) {
  logWarning("[Distributor] 트리거된 워커 없음 → finish");
} else {
  logInfo("[Distributor] Round " + round + " 발사 " + active + " / runId=" + runId);
}

} // limit
} // head
} // finish
