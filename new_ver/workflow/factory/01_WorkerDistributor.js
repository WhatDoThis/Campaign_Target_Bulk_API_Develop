/* ============================================================================
 * TBAWFactory / 01_WorkerDistributor (구간 분할 + PostEvent)
 * ============================================================================
 * pending @apiYn='N' + BIZ_DATE(ingestYmd) 를 lineNo MIN/MAX 등분으로 워커 구간 분할.
 *
 * PostEvent vars: workerName, ingestYmd, bizDate, lineStart, lineEnd, runId, optKey, workerCount
 *
 * [Main Functions]
 * 1. pending 첫 행·remaining 상한
 * 2. sqlSelect MIN/MAX/COUNT 경계 + 밀집도 보정
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
var BIZ_DATE    = String(instance.vars.BIZ_DATE || "");
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
        <node expr="@ingestYmd"/>
        <node expr="@lineNo"/>
      </select>
      <where><condition expr={cond}/></where>
      <orderBy>
        <node expr="@ingestYmd" sortDesc="false"/>
        <node expr="@lineNo" sortDesc="false"/>
      </orderBy>
    </queryDef>
  ).ExecuteQuery();
  var row = { uid: "", ymd: "", line: 0 };
  for each (var r in q[ELEMENT]) {
    row.uid  = String(r.@membershipUid);
    row.ymd  = String(r.@ingestYmd);
    row.line = parseInt(String(r.@lineNo), 10) || 0;
  }
  return row;
}

function fetchUidFromLine(ymd, fromLine, toLine) {
  try {
    var q = xtk.queryDef.create(
      <queryDef schema={SCHEMA} operation="select" lineCount="1">
        <select><node expr="@membershipUid"/><node expr="@lineNo"/></select>
        <where>
          <condition expr={"@apiYn = 'N' AND @ingestYmd = '" + sqlLit(ymd)
            + "' AND @lineNo >= " + fromLine + " AND @lineNo <= " + toLine}/>
        </where>
        <orderBy><node expr="@lineNo" sortDesc="false"/></orderBy>
      </queryDef>
    ).ExecuteQuery();
    for each (var r in q[ELEMENT]) return String(r.@membershipUid);
    return "";
  } catch (e) {
    return "";
  }
}

function splitBounds(ymd, wCount, remaining) {
  if (!TABLE) throw new Error("[Distributor] MEMBER_TABLE 미설정");
  var COND_SQL = String(instance.vars.PENDING_COND_SQL || "s.sapiyn = 'N'");
  var sql = "SELECT MIN(s.ilineno) AS lo, MAX(s.ilineno) AS hi, COUNT(*) AS cnt"
    + " FROM " + TABLE + " s"
    + " WHERE " + COND_SQL;

  var bounds = [];
  var rs;
  try {
    rs = sqlSelect("row,@lo:long,@hi:long,@cnt:long", sql);
  } catch (eSql) {
    throw new Error("[Distributor] bounds sqlSelect 실패: " + (eSql.message || eSql));
  }

  var lo = 0;
  var hi = 0;
  var cnt = 0;
  if (rs && rs.row.length() > 0) {
    for each (var row in rs.row) {
      lo = parseInt(String(row.@lo || row.@LO || 0), 10) || 0;
      hi = parseInt(String(row.@hi || row.@HI || 0), 10) || 0;
      cnt = parseInt(String(row.@cnt || row.@CNT || 0), 10) || 0;
    }
  }
  if (lo < 1 || hi < lo) return bounds;

  var effHi = hi;
  if (remaining > 0 && cnt > remaining) {
    var density = (hi - lo + 1) / cnt;
    effHi = lo + Math.ceil(remaining * density) - 1;
    if (effHi > hi) effHi = hi;
  }

  var span = effHi - lo + 1;
  var wi;
  for (wi = 0; wi < wCount; wi++) {
    var s = lo + Math.floor(span * wi / wCount);
    var e = lo + Math.floor(span * (wi + 1) / wCount) - 1;
    if (wi === wCount - 1) e = effHi;
    if (s >= 1 && e >= s) {
      bounds.push({ ymd: ymd, s: s, e: e, cnt: e - s + 1, idx: wi });
    }
  }

  if (bounds.length < wCount) {
    logWarning("[Distributor] bounds " + bounds.length + "/" + wCount
      + " — remaining=" + remaining);
  }

  var vi;
  for (vi = 1; vi < bounds.length; vi++) {
    if (bounds[vi].s !== bounds[vi - 1].e + 1) {
      throw new Error("[Distributor] 버킷 불연속 b" + vi + " s=" + bounds[vi].s
        + " != b" + (vi - 1) + " e+1=" + (bounds[vi - 1].e + 1));
    }
  }

  var bi;
  for (bi = 0; bi < bounds.length; bi++) {
    logInfo("[Distributor] bucket b" + bi + " line " + bounds[bi].s + "~" + bounds[bi].e);
  }
  return bounds;
}

var head = fetchRow(0, COND);
if (head.uid === "" || head.line < 1 || head.ymd.length !== 8) {
  logInfo("[Distributor] 처리 대상 없음 → finish");
  instance.vars.nextAction = "finish";
  instance.vars.roundSize = 0;
  instance.vars.activeWorkers = 0;
} else if (BIZ_DATE !== "" && head.ymd !== BIZ_DATE) {
  logWarning("[Distributor] head ingestYmd=" + head.ymd + " != BIZ_DATE=" + BIZ_DATE + " → finish");
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
logInfo("[Distributor] ingestYmd=" + head.ymd + " head line=" + head.line
  + " / 이번 라운드 최대 " + remaining + "건");

var bounds = splitBounds(head.ymd, W_COUNT, remaining);
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

var vj;
for (vj = 1; vj < liveJobs.length; vj++) {
  if (liveJobs[vj].b.s !== liveJobs[vj - 1].b.e + 1) {
    throw new Error("[Distributor] 병합 후 구간 불연속 b" + vj + " s=" + liveJobs[vj].b.s
      + " != b" + (vj - 1) + " e+1=" + (liveJobs[vj - 1].b.e + 1));
  }
}

var fireN  = liveJobs.length;
var active = 0;
var names  = [];
var j;
for (j = 0; j < fireN; j++) {
  var job = liveJobs[j];
  setOption(job.key, runId + "|ready", "bulk worker status");
  try {
    if (STAGGER > 0 && j > 0) sleep(STAGGER);
    xtk.workflow.PostEvent(
      job.wf, SIG, "",
      <variables
        workerName={job.name}
        ingestYmd={job.b.ymd}
        bizDate={BIZ_DATE || job.b.ymd}
        lineStart={String(job.b.s)}
        lineEnd={String(job.b.e)}
        runId={runId}
        optKey={job.key}
        workerCount={String(fireN)}/>,
      false
    );
    active++;
    names.push(job.name);
    job.b.su = fetchUidFromLine(job.b.ymd, job.b.s, job.b.e);
    logInfo("  " + job.name + " → " + job.b.ymd + " line " + job.b.s + "~" + job.b.e
      + " (uid " + (job.b.su || "(없음)") + ")");
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
