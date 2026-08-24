/* ============================================================================
 * TBAWFactory / 01_WorkerDistributor (구간 분할 + PostEvent)
 * ============================================================================
 * pending @apiYn='N' 을 lineNo MIN/MAX 등분으로 워커 구간 분할.
 *
 * PostEvent vars: workerName, ingestYm, lineStart, lineEnd, runId, optKey, workerCount
 *
 * [Main Functions]
 * 1. pending 첫 행·remaining 상한
 * 2. sqlSelect MIN/MAX 경계
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

// (변경) NTILE 전체 정렬 → 인덱스 양끝 조회. 밀리초 단위 — FIX-20-B
function splitBounds(ym, wCount, remaining) {
  if (!TABLE) throw new Error("[Distributor] MEMBER_TABLE 미설정");
  var sql = "SELECT MIN(s.ilineno) AS lo, MAX(s.ilineno) AS hi"
    + " FROM " + TABLE + " s"
    + " WHERE s.sapiyn='N' AND s.singestym='" + sqlLit(ym) + "'";

  var bounds = [];
  var rs;
  try {
    // (변경) sqlSelect(format, query) 시그니처 준수 — f-sqlSelect.html
    rs = sqlSelect("row,@lo:long,@hi:long", sql);
  } catch (eSql) {
    throw new Error("[Distributor] bounds sqlSelect 실패: " + (eSql.message || eSql));
  }

  var lo = 0;
  var hi = 0;
  // (변경) E4X 빈 XMLList 도 undefined 가 아님 → length() 로 판정
  if (rs && rs.row.length() > 0) {
    for each (var row in rs.row) {
      lo = parseInt(String(row.@lo || row.@LO || 0), 10) || 0;
      hi = parseInt(String(row.@hi || row.@HI || 0), 10) || 0;
    }
  }
  if (lo < 1 || hi < lo) return bounds;

  var effHi = hi;
  if (remaining > 0 && (hi - lo + 1) > remaining) {
    effHi = lo + remaining - 1;
  }

  var span = effHi - lo + 1;
  var wi;
  for (wi = 0; wi < wCount; wi++) {
    var s = lo + Math.floor(span * wi / wCount);
    var e = lo + Math.floor(span * (wi + 1) / wCount) - 1;
    if (wi === wCount - 1) e = effHi;
    if (s >= 1 && e >= s) {
      bounds.push({ ym: ym, s: s, e: e, cnt: e - s + 1, idx: wi });
    }
  }

  // (변경) 버킷 수 부족 = 구간 소실 신호
  if (bounds.length < wCount) {
    logWarning("[Distributor] bounds " + bounds.length + "/" + wCount
      + " — remaining=" + remaining);
  }

  // (변경) 인접 버킷 경계 겹침 검증
  var vi;
  for (vi = 1; vi < bounds.length; vi++) {
    if (bounds[vi].s <= bounds[vi - 1].e) {
      throw new Error("[Distributor] 버킷 경계 겹침 b" + vi + " s=" + bounds[vi].s
        + " <= b" + (vi - 1) + " e=" + bounds[vi - 1].e);
    }
  }

  var bi;
  for (bi = 0; bi < bounds.length; bi++) {
    bounds[bi].su = fetchUidAtLine(ym, bounds[bi].s);
    bounds[bi].eu = fetchUidAtLine(ym, bounds[bi].e);
    logInfo("[Distributor] bucket " + (bi + 1) + " line "
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

var bounds = splitBounds(head.ym, W_COUNT, remaining);
var runId  = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S") + "R" + round;

// (변경) state 의미 통일. 11 = 시작됨. 13 = 일시중지 / 20 = 중지
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

// (변경) 미시작 워커 버킷을 버리지 않고 이월 대상으로 수집
var liveJobs = [];
var orphan   = [];
var w;
for (w = 0; w < W_COUNT; w++) {
  var wName  = String(instance.vars.WORKER_NAME_TPL).replace("{n}", String(w + 1));
  var wWf    = String(instance.vars.WORKER_WF_TPL).replace("{n}", String(w + 1));
  var optKey = OPT_PREFIX + wName;

  if (w >= bounds.length) {
    setOption(optKey, runId + "|skip", "bulk worker status");
    continue;
  }
  if (!wfStarted(wWf)) {
    setOption(optKey, runId + "|skip", "bulk worker status");
    logWarning("  " + wName + " : " + wWf + " 미시작 → 버킷 이월");
    orphan.push({ b: bounds[w], idx: w });
    continue;
  }
  liveJobs.push({ name: wName, wf: wWf, key: optKey, b: bounds[w], idx: w });
}

// (변경) 라운드로빈 → 인접 병합. 비인접 결합 시 구간 겹침 발생
var oi;
for (oi = 0; oi < orphan.length; oi++) {
  if (liveJobs.length === 0) break;
  var ob   = orphan[oi];
  var oidx = ob.idx;
  var tgt  = null;
  var li;
  for (li = 0; li < liveJobs.length; li++) {
    if (liveJobs[li].idx < oidx) {
      if (!tgt || liveJobs[li].idx > tgt.idx) tgt = liveJobs[li];
    }
  }
  if (tgt) {
    if (ob.b.e > tgt.b.e) tgt.b.e = ob.b.e;
  } else {
    var nextLive = null;
    for (li = 0; li < liveJobs.length; li++) {
      if (liveJobs[li].idx > oidx) {
        if (!nextLive || liveJobs[li].idx < nextLive.idx) nextLive = liveJobs[li];
      }
    }
    tgt = nextLive;
    if (tgt && ob.b.s < tgt.b.s) tgt.b.s = ob.b.s;
  }
  if (tgt) {
    logInfo("  고아 버킷 병합 b" + oidx + " → " + tgt.name
      + " 구간 " + tgt.b.s + "~" + tgt.b.e);
  }
}

// (변경) 병합 후 b.s 오름차순 정렬
var si;
for (si = 0; si < liveJobs.length - 1; si++) {
  var sj;
  for (sj = si + 1; sj < liveJobs.length; sj++) {
    if (liveJobs[sj].b.s < liveJobs[si].b.s) {
      var tmpJ = liveJobs[si];
      liveJobs[si] = liveJobs[sj];
      liveJobs[sj] = tmpJ;
    }
  }
}

// (변경) 병합 후 겹침 재검증
var vj;
for (vj = 1; vj < liveJobs.length; vj++) {
  if (liveJobs[vj].b.s <= liveJobs[vj - 1].b.e) {
    throw new Error("[Distributor] 병합 후 버킷 겹침 b" + vj + " s=" + liveJobs[vj].b.s
      + " <= b" + (vj - 1) + " e=" + liveJobs[vj - 1].b.e);
  }
}

var fireN  = liveJobs.length;
var active = 0;
var names  = [];
var j;
// (변경) jobs → liveJobs. 이월 반영된 구간으로 발사
for (j = 0; j < fireN; j++) {
  var job = liveJobs[j];
  setOption(job.key, runId + "|ready", "bulk worker status");
  try {
    if (STAGGER > 0 && j > 0) sleep(STAGGER);
    xtk.workflow.PostEvent(
      job.wf, SIG, "",
      <variables
        workerName={job.name}
        ingestYm={job.b.ym}
        lineStart={String(job.b.s)}
        lineEnd={String(job.b.e)}
        runId={runId}
        optKey={job.key}
        workerCount={String(fireN)}/>,
      false
    );
    active++;
    names.push(job.name);
    logInfo("  " + job.name + " → " + job.b.ym + " line " + job.b.s + "~" + job.b.e
      + " (" + job.b.su + "~" + job.b.eu + ")");
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
