// ============================================================
// 01_Worker Distributor — 대상 산정 → 워커 분배 → PostEvent
// Activity: JavaScript Code (라운드마다 실행)
// ============================================================

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

var SCHEMA     = String(instance.vars.MEMBER_SCHEMA);
var ELEMENT    = String(instance.vars.MEMBER_ELEMENT);
var COND       = String(instance.vars.PENDING_COND);
var W_COUNT    = NUM(instance.vars.WORKER_COUNT, 5);
var BATCH_SIZE = NUM(instance.vars.BATCH_SIZE, 5000);
var ROUND_LIMIT= NUM(instance.vars.ROUND_LIMIT, 500000);
var GRAND_TOTAL= NUM(instance.vars.GRAND_TOTAL, 0);
var MODE       = String(instance.vars.PARTITION_MODE);
var UID_PREFIX = String(instance.vars.UID_PREFIX);
var UID_DIGITS = NUM(instance.vars.UID_DIGITS, 9);
var OPT_PREFIX = String(instance.vars.OPT_PREFIX);
var EXACT      = (String(instance.vars.EXACT_COUNT) == "true");

var round     = NUM(instance.vars.round) + 1;
var processed = NUM(instance.vars.globalProcessed);
instance.vars.round = round;

logInfo("===== [Distributor] Round " + round + " 시작 (누적 " + processed + "건) =====");

// ---------- UID 문자열 <-> 숫자 ----------
var PAD = "";
for (var p = 0; p < UID_DIGITS; p++) PAD += "0";
function uidToNum(uid) { return parseInt(String(uid).substring(UID_PREFIX.length), 10); }
function numToUid(n)   { return UID_PREFIX + (PAD + n).slice(-UID_DIGITS); }

// ---------- 경계 UID 1건 조회 (offset / 정렬방향 지정) ----------
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
  for each (var r in q[ELEMENT]) { uid = String(r.@membershipUid); }
  return uid;
}

// ---------- 1) 대상 범위 확인 ----------
var minUid = fetchUid(0, false);      // 인덱스 정방향 1건
if (minUid == "") {
  logInfo("[Distributor] 처리 대상 없음 → 종료");
  instance.vars.nextAction = "finish";
  instance.vars.roundSize  = 0;
  instance.vars.activeWorkers = 0;
} else {
  var maxUid = fetchUid(0, true);     // 인덱스 역방향 1건
  var minNum = uidToNum(minUid);
  var maxNum = uidToNum(maxUid);

  // 이번 라운드 상한: 라운드 제한 + 전체 상한 동시 적용
  var limit = ROUND_LIMIT;
  if (GRAND_TOTAL > 0) limit = Math.min(limit, GRAND_TOTAL - processed);

  if (limit <= 0) {
    logInfo("[Distributor] 전체 상한(" + GRAND_TOTAL + ") 도달 → 종료");
    instance.vars.nextAction = "finish";
    instance.vars.roundSize  = 0;
    instance.vars.activeWorkers = 0;
  } else {
    // 정확한 건수가 필요할 때만 count (대용량에서는 full scan)
    var remaining;
    if (EXACT) {
      var c = xtk.queryDef.create(
        <queryDef schema={SCHEMA} operation="count">
          <where><condition expr={COND}/></where>
        </queryDef>
      ).ExecuteQuery();
      remaining = Math.min(limit, NUM(c.@count, 0));
      logInfo("[Distributor] 미전송 건수(정확): " + NUM(c.@count, 0));
    } else {
      remaining = limit;   // 범위 기반. 실제 처리량은 워커가 보고
      logInfo("[Distributor] 미전송 건수: 미측정 (범위 기반 분배)");
    }

    logInfo("[Distributor] 대상 UID 범위: " + minUid + " ~ " + maxUid
            + " / 라운드 상한 " + remaining + "건");

    // ---------- 2) 워커 경계 계산 ----------
    var runId  = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S") + "R" + round;
    var bounds = [];   // [{s:startUid, e:endUid, size:n}]

    if (MODE == "offset") {
      // 정확 분할: 경계 offset을 순서대로 조회 (W_COUNT+1회)
      var perW = Math.ceil(remaining / W_COUNT);
      var marks = [];
      for (var m = 0; m < W_COUNT; m++) {
        var off = m * perW;
        if (off >= remaining) break;
        marks.push(off);
      }
      marks.push(remaining - 1);   // 마지막 레코드 위치
      for (var b = 0; b < marks.length - 1; b++) {
        var sUid = fetchUid(marks[b], false);
        var eUid = (b == marks.length - 2)
                 ? fetchUid(marks[marks.length - 1], false)
                 : numToUid(uidToNum(fetchUid(marks[b + 1], false)) - 1);
        if (sUid == "" || eUid == "") continue;
        bounds.push({ s: sUid, e: eUid, size: marks[b + 1] - marks[b] });
      }
    } else {
      // 산술 분할: 인덱스 조회 2회로 끝 (권장)
      var endNum = Math.min(minNum + remaining - 1, maxNum);
      var span   = endNum - minNum + 1;
      var perW   = Math.ceil(span / W_COUNT);
      for (var b = 0; b < W_COUNT; b++) {
        var sN = minNum + (b * perW);
        if (sN > endNum) break;
        var eN = Math.min(sN + perW - 1, endNum);
        bounds.push({ s: numToUid(sN), e: numToUid(eN), size: eN - sN + 1 });
      }
    }

    // ---------- 3) 옵션 초기화 + PostEvent ----------
    var active = 0;
    var names  = [];

    for (var w = 0; w < W_COUNT; w++) {
      var wName = instance.vars.WORKER_NAME_TPL.replace("{n}", String(w + 1));
      var wWf   = instance.vars.WORKER_WF_TPL.replace("{n}", String(w + 1));
      var wSig  = instance.vars.WORKER_SIG_TPL.replace("{w}", wName)
                                              .replace("{n}", String(w + 1));
      var optKey = OPT_PREFIX + "STATUS_" + wName;

      if (w >= bounds.length) {
        // 할당 없는 워커: 이전 라운드 잔여값이 폴링을 오염시키지 않도록 skip 기록
        setOption(optKey, runId + "|skip", "bulk worker status");
        logInfo("  " + wName + " : 할당 없음 (skip)");
        continue;
      }

      setOption(optKey, runId + "|ready", "bulk worker status");

      try {
        xtk.workflow.PostEvent(
          wWf, wSig, "",
          <variables runId={runId}
                     workerName={wName}
                     uidStart={bounds[w].s}
                     uidEnd={bounds[w].e}
                     batchSize={String(BATCH_SIZE)}
                     optKey={optKey}/>,
          false
        );
        active++;
        names.push(wName);
        logInfo("  " + wName + " → " + wWf + "/" + wSig + " : "
                + bounds[w].s + " ~ " + bounds[w].e + " (약 " + bounds[w].size + "건)");
      } catch (e) {
        setOption(optKey, runId + "|error", "bulk worker status");
        logError("  " + wName + " PostEvent 실패: " + e.message);
      }
    }

    instance.vars.runId         = runId;
    instance.vars.activeWorkers = active;
    instance.vars.workerNames   = names.join(",");
    instance.vars.roundSize     = remaining;
    instance.vars.pollCount     = 0;
    instance.vars.nextAction    = "working";

    // ready 재시도 카운터 리셋
    for (var r = 1; r <= W_COUNT; r++) instance.vars["readyRetry_" + r] = 0;

    if (active == 0) {
      logWarning("[Distributor] 트리거된 워커 없음 → 종료");
      instance.vars.nextAction = "finish";
    } else {
      logInfo("[Distributor] Round " + round + " 트리거 완료: "
              + active + "개 워커 / runId=" + runId);
    }
  }
}
