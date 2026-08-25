/* ============================================================================
 * TBAWFactory / 02_Polling (워커 완료 + pending 잔량 판정)
 * ============================================================================
 * 라운드 완료 후 Sample apiYn='N' 잔량으로 finish/next 결정.
 *
 * [Main Functions]
 * 1. Option 파싱 (STRICT runId)
 * 2. countPending — @apiYn='N' 존재 여부 (count 회피)
 * 3. nextAction: working | next | finish + 종료 요약 배너
 *
 * [Dependencies]
 * getOption, xtk.queryDef
 * ==========================================================================*/

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

if (String(instance.vars.nextAction) === "finish") {
  logInfo("[Polling] 종료 상태 — 폴링 생략");
} else {

  var W_COUNT     = NUM(instance.vars.WORKER_COUNT, 3);
  var SCHEMA      = String(instance.vars.MEMBER_SCHEMA);
  var ELEMENT     = String(instance.vars.MEMBER_ELEMENT);
  var PENDING     = String(instance.vars.PENDING_COND || "@apiYn = 'N' AND @lineNo >= 1");
  var OPT_PREFIX  = String(instance.vars.OPT_PREFIX);
  var RUN_ID      = String(instance.vars.runId || "");
  var STRICT      = (String(instance.vars.STRICT_RUNID) === "true");
  var ABORT_ERR   = (String(instance.vars.ABORT_ON_WORKER_ERROR) === "true");
  var MAX_READY   = NUM(instance.vars.MAX_READY_POLL, 5);
  var MAX_RUN     = NUM(instance.vars.MAX_RUN_POLL, 360);
  var GRAND_TOTAL = NUM(instance.vars.GRAND_TOTAL, 0);
  var MAX_ROUND   = NUM(instance.vars.MAX_ROUND, 200);
  var MAX_STALL   = NUM(instance.vars.MAX_STALL, 3);

  var poll = NUM(instance.vars.pollCount) + 1;
  instance.vars.pollCount = poll;

  var pendingW = 0;
  var errors   = [];
  var summary  = [];
  var sentSum  = 0;
  var failedSum = 0;
  var BIZ_DATE  = String(instance.vars.BIZ_DATE || "");

  var w;
  for (w = 1; w <= W_COUNT; w++) {
    var wName  = String(instance.vars.WORKER_NAME_TPL).replace("{n}", String(w));
    var optKey = OPT_PREFIX + wName;
    var raw = "";
    try { raw = String(getOption(optKey, false) || ""); } catch (e) { raw = ""; }

    var parts  = raw.split("|");
    var optRun = (parts.length > 1) ? parts[0] : "";
    var status = (parts.length > 1) ? parts[1] : parts[0];
    var sent   = (parts.length > 2) ? NUM(parts[2], 0) : 0;
    var failed = (parts.length > 3) ? NUM(parts[3], 0) : 0;

    if (STRICT && RUN_ID !== "" && optRun !== RUN_ID) {
      summary.push(wName + "=stale(" + (status || "none") + ")");
      pendingW++;
      continue;
    }

    summary.push(wName + "=" + (status || "none")
      + (sent ? ":" + sent : "") + (failed ? "/f" + failed : ""));

    if (status === "done" || status === "skip") {
      instance.vars["readyRetry_" + w] = 0;
      if (status === "done") {
        sentSum += sent;
        failedSum += failed;
      }
    } else if (status === "error") {
      errors.push(wName);
    } else if (status === "ready") {
      var rc = NUM(instance.vars["readyRetry_" + w]) + 1;
      instance.vars["readyRetry_" + w] = rc;
      if (rc >= MAX_READY) {
        errors.push(wName + "(signal timeout " + rc + ")");
      } else {
        pendingW++;
      }
    } else {
      instance.vars["readyRetry_" + w] = 0;
      pendingW++;
    }
  }

  logInfo("[Polling #" + poll + "] " + summary.join(", "));

  if (pendingW > 0 && poll >= MAX_RUN) {
    errors.push("ROUND_TIMEOUT(poll " + poll + ")");
    pendingW = 0;
  }

  if (errors.length > 0) {
    var msg = "[Polling] 워커 이상: " + errors.join(", ");
    if (ABORT_ERR) {
      logError(msg + " → 중단");
      throw new Error(msg);
    }
    logWarning(msg + " → 계속 (apiYn=N 잔여는 다음 라운드)");
  }

  if (pendingW > 0) {
    instance.vars.nextAction = "working";
    logInfo("[Polling] 워커 진행 중 (" + pendingW + "개)");
  } else {
    var processed = NUM(instance.vars.globalProcessed) + sentSum;
    instance.vars.globalProcessed = processed;
    instance.vars.globalFailed = NUM(instance.vars.globalFailed) + failedSum;
    logInfo("=== Round " + instance.vars.round + " 워커 완료 / sent="
      + sentSum + " / failed=" + failedSum + " / 누적 sent=" + processed
      + " failed=" + instance.vars.globalFailed + " ===");

    // 전체 count 회피. pending 1건 존재 여부만 확인
    // countStatus: 1=잔량있음 / 0=없음 / -1=조회실패
    var countStatus = -1;
    try {
      var pq = xtk.queryDef.create(
        <queryDef schema={SCHEMA} operation="select" lineCount="1">
          <select><node expr="@lineNo"/></select>
          <where><condition expr={PENDING}/></where>
        </queryDef>
      ).ExecuteQuery();
      countStatus = 0;
      for each (var pr in pq[ELEMENT]) { countStatus = 1; }
    } catch (eCnt) {
      logError("[Polling] pending 조회 실패: " + (eCnt.message || eCnt));
    }

    instance.vars.pendingExists = countStatus;
    logInfo("[Polling] pending 존재=" + countStatus);

    // countStatus 우선순위: 조회실패(-1) → 잔량없음(0) → GRAND_TOTAL → next
    // 조회 실패 반복 시 MAX_ROUND 초과하면 finish
    var roundNo = parseInt(instance.vars.round, 10) || 0;
    if (countStatus < 0) {
      if (roundNo >= MAX_ROUND) {
        logError("[Polling] 라운드 상한 " + MAX_ROUND + " 초과 → 강제 종료");
        instance.vars.nextAction = "finish";
      } else {
        instance.vars.nextAction = "next";
        logWarning("[Polling] pending 조회 실패 → next (재분배)");
      }
    } else if (countStatus === 0) {
      instance.vars.nextAction = "finish";
      logInfo("[Polling] 미전송 0건 → finish");
    } else if (GRAND_TOTAL > 0 && processed >= GRAND_TOTAL) {
      instance.vars.nextAction = "finish";
      logWarning("[Polling] GRAND_TOTAL(" + GRAND_TOTAL + ") 도달. 미전송 잔존 → 다음 실행");
    } else {
      instance.vars.nextAction = "next";
      logInfo("[Polling] 미전송 잔존 → next");
    }

    var prevProcessed = NUM(instance.vars.prevProcessed, -1);
    if (String(instance.vars.nextAction) === "next") {
      if (processed <= prevProcessed) {
        var stall = NUM(instance.vars.stallCount) + 1;
        instance.vars.stallCount = stall;
        if (stall >= MAX_STALL) {
          instance.vars.nextAction = "finish";
          logError("[Polling] " + MAX_STALL + "라운드 연속 처리량 0 → 강제 종료"
            + " processed=" + processed
            + " / 워커상태=" + summary.join(", ")
            + " / skip 다수면 TBAW1~N WF state=11(시작됨) 확인");
        }
      } else {
        instance.vars.stallCount = 0;
      }
      instance.vars.prevProcessed = processed;
    }

    if (String(instance.vars.nextAction) === "finish") {
      var startCnt = NUM(instance.vars.pendingStartCnt, -1);
      logInfo("===== [Factory] 종료 =====");
      logInfo("  sessionRunId=" + String(instance.vars.sessionRunId || "")
        + " / BIZ_DATE=" + BIZ_DATE
        + " / rounds=" + roundNo
        + " / sent=" + processed
        + " / failed=" + NUM(instance.vars.globalFailed, 0)
        + " / pendingStart=" + (startCnt >= 0 ? startCnt : "?")
        + " / pendingRemain=" + (countStatus === 1 ? "Y" : (countStatus === 0 ? "N" : "?")));
    }
  }
}
