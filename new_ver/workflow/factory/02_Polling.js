// ============================================================
// 02_Polling — 워커 완료 감지 / 타임아웃 / 다음 액션 결정
// Activity: JavaScript Code (Wait 직후, 1분 주기)
// 결과: instance.vars.nextAction = working | next | finish
// ============================================================

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

// 이미 종료 판정된 경우 폴링 스킵 (대상 없음 / 상한 도달)
if (String(instance.vars.nextAction) == "finish") {
  logInfo("[Polling] 종료 상태 - 폴링 생략");
} else {

  var W_COUNT     = NUM(instance.vars.WORKER_COUNT, 5);
  var OPT_PREFIX  = String(instance.vars.OPT_PREFIX);
  var RUN_ID      = String(instance.vars.runId || "");
  var STRICT      = (String(instance.vars.STRICT_RUNID) == "true");
  var ABORT_ERR   = (String(instance.vars.ABORT_ON_WORKER_ERROR) == "true");
  var MAX_READY   = NUM(instance.vars.MAX_READY_POLL, 5);
  var MAX_RUN     = NUM(instance.vars.MAX_RUN_POLL, 180);
  var GRAND_TOTAL = NUM(instance.vars.GRAND_TOTAL, 0);

  var poll = NUM(instance.vars.pollCount) + 1;
  instance.vars.pollCount = poll;

  var pending = 0;
  var errors  = [];
  var summary = [];

  for (var w = 1; w <= W_COUNT; w++) {
    var wName  = instance.vars.WORKER_NAME_TPL.replace("{n}", String(w));
    var optKey = OPT_PREFIX + "STATUS_" + wName;

    // useCache=false : 캐시로 인한 stale 상태 판독 방지 (중요)
    var raw = "";
    try { raw = String(getOption(optKey, false) || ""); } catch (e) { raw = ""; }

    var parts  = raw.split("|");
    var optRun = (parts.length > 1) ? parts[0] : "";
    var status = (parts.length > 1) ? parts[1] : parts[0];

    // 이전 라운드의 잔여 상태를 완료로 오인하지 않도록 runId 검증
    if (STRICT && RUN_ID != "" && optRun != RUN_ID) {
      summary.push(wName + "=stale(" + (status || "none") + ")");
      pending++;
      continue;
    }

    summary.push(wName + "=" + (status || "none"));

    if (status == "done" || status == "skip") {
      instance.vars["readyRetry_" + w] = 0;

    } else if (status == "error") {
      errors.push(wName);

    } else if (status == "ready") {
      // 시그널 미수신 상태. 워커 WF 미시작 / 정지 가능성
      var rc = NUM(instance.vars["readyRetry_" + w]) + 1;
      instance.vars["readyRetry_" + w] = rc;
      if (rc >= MAX_READY) {
        errors.push(wName + "(signal timeout " + rc + ")");
      } else {
        pending++;
      }

    } else {
      // running / 기타 진행 상태
      instance.vars["readyRetry_" + w] = 0;
      pending++;
    }
  }

  logInfo("[Polling #" + poll + "] " + summary.join(", "));

  // ---------- 라운드 전체 타임아웃 ----------
  if (pending > 0 && poll >= MAX_RUN) {
    errors.push("ROUND_TIMEOUT(poll " + poll + ")");
    pending = 0;
  }

  // ---------- 에러 처리 ----------
  if (errors.length > 0) {
    var msg = "[Polling] 워커 이상: " + errors.join(", ");
    if (ABORT_ERR) {
      logError(msg + " → 워크플로우 중단");
      throw new Error(msg);
    }
    logWarning(msg + " → 해당 워커 제외하고 계속 (apiYn='N' 유지분은 다음 라운드 재처리)");
  }

  // ---------- 진행/완료 판정 ----------
  if (pending > 0) {
    instance.vars.nextAction = "working";
    logInfo("[Polling] 진행 중 (" + pending + "개 워커 대기)");
  } else {
    var processed = NUM(instance.vars.globalProcessed) + NUM(instance.vars.roundSize);
    instance.vars.globalProcessed = processed;
    instance.vars.workersComplete = "true";

    logInfo("=== Round " + instance.vars.round + " 완료 / 누적 " + processed + "건 ===");

    if (GRAND_TOTAL > 0 && processed >= GRAND_TOTAL) {
      instance.vars.nextAction = "finish";
      logInfo("[Polling] 전체 상한(" + GRAND_TOTAL + ") 도달 → 종료");
    } else {
      instance.vars.nextAction = "next";
      logInfo("[Polling] 다음 라운드 진행");
    }
  }
}
