/* ============================================================================
 * TBAWFactory / 01_WorkerDistributor (구간 분할 + PostEvent)
 * ============================================================================
 * pending @apiYn='N' + @ingestYmd(BIZ_DATE) + lineNo 구간 등분.
 * PENDING_COND(Config)에 ingestYmd 고정 → orderBy @lineNo 만 사용.
 *
 * PostEvent vars: workerName, ingestYmd, bizDate, lineStart, lineEnd, runId, optKey,
 *   workerCount, workerMax, batchSize, customAttr, accountCpm, statusCpm, safetyRatio, staggerSlotMs
 *
 * [Main Functions]
 * 1. fetchHeadSql — pending head sqlSelect (PENDING_COND_SQL) · sparse offset/tail queryDef
 * 2. splitBounds — dense: 산술 cap / sparse: offset tail
 * 3. 워커 WF PostEvent
 *
 * [Dependencies]
 * sqlSelect, xtk.queryDef, xtk.workflow.PostEvent, setOption
 * ==========================================================================*/

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

if (String(instance.vars.nextAction) === "finish") {
  logInfo("[Distributor] finish 상태 — 분배 생략");
} else {

var SCHEMA      = String(instance.vars.MEMBER_SCHEMA);
var ELEMENT     = String(instance.vars.MEMBER_ELEMENT);
var COND        = String(instance.vars.PENDING_COND);
var PENDING_SQL = String(instance.vars.PENDING_COND_SQL || "");
var MEM_TABLE   = String(instance.vars.MEMBER_TABLE || "");
var BIZ_DATE    = String(instance.vars.BIZ_DATE || "");
var DENSE_SPLIT = (String(instance.vars.DENSE_LINE_SPLIT || "true") === "true");
var W_COUNT     = NUM(instance.vars.WORKER_COUNT, 3);
var ROUND_LIMIT = NUM(instance.vars.ROUND_LIMIT, 10000000);
var GRAND_TOTAL = NUM(instance.vars.GRAND_TOTAL, 0);
var OPT_PREFIX  = String(instance.vars.OPT_PREFIX);
var SIG         = String(instance.vars.WORKER_SIG || "sigWorker");
var STAGGER     = NUM(instance.vars.STAGGER_POST_MS, 0);

var round     = NUM(instance.vars.round) + 1;
var processed = NUM(instance.vars.globalProcessed);
instance.vars.round = round;
logInfo("===== [Distributor] Round " + round + " 시작 (누적 sent " + processed + ") =====");

// # 1. fetchHeadSql — dense head: sqlSelect(~20ms). 실패 시 queryDef fallback
function fetchHeadSql() {
  var row = { uid: "", ymd: "", line: 0 };
  if (!MEM_TABLE || !PENDING_SQL) {
    logWarning("[Distributor] MEMBER_TABLE/PENDING_COND_SQL 없음 — queryDef fallback");
    return fetchRow(0, COND);
  }
  var sql = "SELECT s.smembershipuid AS uid, s.singestymd AS ymd, s.ilineno AS line"
    + " FROM " + MEM_TABLE + " s WHERE " + PENDING_SQL
    + " ORDER BY s.ilineno ASC LIMIT 1";
  try {
    var t0 = new Date().getTime();
    var rs = sqlSelect("row,@uid:string,@ymd:string,@line:long", sql);
    if (rs && rs.row.length() > 0) {
      for each (var r in rs.row) {
        row.uid  = String(r.@uid || "");
        row.ymd  = String(r.@ymd || "");
        row.line = parseInt(String(r.@line), 10) || 0;
      }
    }
    logInfo("[Distributor] head sqlSelect " + (new Date().getTime() - t0)
      + "ms line=" + row.line);
    return row;
  } catch (eHead) {
    logWarning("[Distributor] head sqlSelect 실패 — queryDef fallback: "
      + (eHead.message || eHead));
    return fetchRow(0, COND);
  }
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
      <orderBy><node expr="@lineNo" sortDesc="false"/></orderBy>
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

function fetchLastPending() {
  var q = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select" lineCount="1">
      <select>
        <node expr="@membershipUid"/>
        <node expr="@ingestYmd"/>
        <node expr="@lineNo"/>
      </select>
      <where><condition expr={COND}/></where>
      <orderBy><node expr="@lineNo" sortDesc="true"/></orderBy>
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

function splitBounds(head, wCount, remaining) {
  var bounds = [];
  var lo = parseInt(head.line, 10) || 0;
  var ymd = String(head.ymd || "");
  if (lo < 1 || ymd.length !== 8) return bounds;

  var effHi = (remaining > 0) ? lo + remaining - 1 : lo;
  var tailMax = effHi;

  if (!DENSE_SPLIT) {
    var last = fetchLastPending();
    tailMax = (last.line >= lo) ? last.line : lo;
    if (last.line >= lo && last.line < effHi) {
      effHi = last.line;
    }
    if (remaining > 0) {
      var tail = fetchRow(remaining - 1, COND);
      if (tail.line >= lo) {
        effHi = tail.line;
      } else if (last.line >= lo) {
        effHi = last.line;
      }
    } else if (last.line >= lo) {
      effHi = last.line;
    }
  }

  logInfo("[Distributor] round line " + lo + "~" + effHi
    + " / cap " + remaining
    + " / queueTail=" + tailMax
    + (DENSE_SPLIT ? " (dense-cap)" : " (offset-tail)"));

  var span = effHi - lo + 1;
  if (span < 1) return bounds;

  var wi;
  for (wi = 0; wi < wCount; wi++) {
    var s = lo + Math.floor(span * wi / wCount);
    var e = lo + Math.floor(span * (wi + 1) / wCount) - 1;
    if (wi === wCount - 1) e = effHi;
    if (s >= 1 && e >= s) {
      bounds.push({ ymd: ymd, s: s, e: e, cnt: e - s + 1, idx: bounds.length });
    }
    if (e >= effHi) break;
  }

  if (bounds.length < wCount) {
    logWarning("[Distributor] bounds " + bounds.length + "/" + wCount
      + " — remaining=" + remaining);
  }

  var vi;
  for (vi = 1; vi < bounds.length; vi++) {
    if (bounds[vi].s !== bounds[vi - 1].e + 1) {
      logWarning("[Distributor] 버킷 불연속 보정 b" + vi + " " + bounds[vi].s
        + " → " + (bounds[vi - 1].e + 1));
      bounds[vi].s = bounds[vi - 1].e + 1;
      bounds[vi].cnt = bounds[vi].e - bounds[vi].s + 1;
    }
  }

  var bi;
  for (bi = 0; bi < bounds.length; bi++) {
    logInfo("[Distributor] bucket b" + bi + " line " + bounds[bi].s + "~" + bounds[bi].e);
  }
  return bounds;
}

logInfo("[Distributor] pending head 조회...");
var head = fetchHeadSql();
if (head.uid === "" || head.line < 1 || head.ymd.length !== 8) {
  logInfo("[Distributor] 처리 대상 없음 → finish");
  instance.vars.nextAction = "finish";
  instance.vars.finishReason = "no_target";
  instance.vars.roundSize = 0;
  instance.vars.activeWorkers = 0;
} else {

var limit = ROUND_LIMIT;
if (GRAND_TOTAL > 0) limit = Math.min(limit, GRAND_TOTAL - processed);
if (limit <= 0) {
  logInfo("[Distributor] GRAND_TOTAL 상한 도달 → finish");
  instance.vars.nextAction = "finish";
  instance.vars.finishReason = (processed > 0) ? "cap_reached" : "no_target";
  instance.vars.roundSize = 0;
  instance.vars.activeWorkers = 0;
} else {

var remaining = limit;
logInfo("[Distributor] ingestYmd=" + head.ymd + " head line=" + head.line
  + " / 이번 라운드 최대 " + remaining + "건");

var bounds = splitBounds(head, W_COUNT, remaining);
instance.vars.roundPendingCap = remaining;
var runId  = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S") + "R" + round;
instance.vars.runId = runId;
instance.vars.pollCount = 0;
var rr;
for (rr = 1; rr <= W_COUNT; rr++) { instance.vars["readyRetry_" + rr] = 0; }

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
  var gapS = liveJobs[vj - 1].b.e + 1;
  if (liveJobs[vj].b.s > gapS) {
    logWarning("[Distributor] 구간 공백 " + gapS + "~" + (liveJobs[vj].b.s - 1)
      + " → " + liveJobs[vj].name + " 로 흡수");
    liveJobs[vj].b.s = gapS;
  } else if (liveJobs[vj].b.s < gapS) {
    logWarning("[Distributor] 구간 중복 " + liveJobs[vj].b.s + "~" + (gapS - 1)
      + " → " + liveJobs[vj].name + " 시작점 " + gapS + " 로 보정");
    liveJobs[vj].b.s = gapS;
  }
  liveJobs[vj].b.cnt = liveJobs[vj].b.e - liveJobs[vj].b.s + 1;
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
        workerCount={String(fireN)}
        workerMax={String(instance.vars.WORKER_MAX || "")}
        batchSize={String(instance.vars.BATCH_SIZE || "")}
        customAttr={String(instance.vars.CUSTOM_ATTR || "")}
        accountCpm={String(instance.vars.ACCOUNT_CPM || "")}
        statusCpm={String(instance.vars.STATUS_CPM || "")}
        safetyRatio={String(instance.vars.SAFETY_RATIO || "")}
        staggerSlotMs={String(instance.vars.STAGGER_SLOT_MS || "")}/>,
      false
    );
    active++;
    names.push(job.name);
    logInfo("  " + job.name + " → " + job.b.ymd + " line " + job.b.s + "~" + job.b.e);
  } catch (ePe) {
    setOption(job.key, runId + "|error", "bulk worker status");
    logError("  " + job.name + " PostEvent 실패: " + (ePe.message || ePe));
  }
}

instance.vars.activeWorkers = active;
instance.vars.workerNames   = names.join(",");
instance.vars.roundSize     = remaining;
instance.vars.nextAction    = (active === 0) ? "finish" : "working";
if (active === 0) {
  instance.vars.finishReason = "no_workers";
  logWarning("[Distributor] 트리거된 워커 없음 → finish");
} else {
  logInfo("[Distributor] Round " + round + " 발사 " + active + " / runId=" + runId);
}

} // limit
} // head
} // finish
