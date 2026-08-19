// ============================================================
// 폴링 JS — 3개 워커 완료 여부 확인 + ready 방어
// ============================================================

var WORKER_COUNT = instance.vars.WORKER_COUNT;
var MAX_READY_RETRY = 3;  // ready 상태 3회 연속 시 강제 에러
var allDone = true;
var hasError = false;

for (var w = 1; w <= WORKER_COUNT; w++) {
  var key = "WORKER_DONE_TBAW" + w;
  var status = getOption(key);
  logInfo("Worker TBAW" + w + " 상태: " + status);

  if (status == "done") {
    continue;

  } else if (status == "error") {
    hasError = true;
    logWarning("[Polling] TBAW" + w + " 에러 감지");
    break;

  } else if (status == "ready") {
    var retryKey = "readyRetry_TBAW" + w;
    var cnt = parseInt(instance.vars[retryKey] || 0) + 1;
    instance.vars[retryKey] = cnt;
    logWarning("[Polling] TBAW" + w + " 여전히 ready (" + cnt + "/" + MAX_READY_RETRY + ")");

    if (cnt >= MAX_READY_RETRY) {
      hasError = true;
      logWarning("[Polling] TBAW" + w + " ready " + MAX_READY_RETRY + "회 초과 → 에러 처리");
      break;
    }
    allDone = false;

  } else {
    // running 상태 → ready 카운트 리셋
    instance.vars["readyRetry_TBAW" + w] = 0;
    allDone = false;
  }
}

if (hasError) {
  throw new Error("[Polling] 워커 에러 감지 – 워크플로우 중단");
}

// ── 기존 로직 유지 ──
if (allDone) {
  var roundSize = parseInt(instance.vars.roundSize || 0);
  var prev = parseInt(instance.vars.globalProcessed || 0);
  instance.vars.globalProcessed = prev + roundSize;
  instance.vars.workersComplete = "true";
  logInfo("=== 라운드 완료 === 누적: " + instance.vars.globalProcessed);
} else {
  instance.vars.workersComplete = "false";
  logInfo("워커 진행 중... 다음 폴링 대기");
}
