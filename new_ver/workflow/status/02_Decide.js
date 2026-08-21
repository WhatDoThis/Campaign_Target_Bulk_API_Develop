/* ============================================================================
 * TBAWStatus / 02_Decide (잔여 pending → working | finish)
 * ============================================================================
 * pending = success=1 + URL + (빈값|incomplete)
 * complete/stuck 는 종료. incomplete 는 Wait 후 01.
 *
 * [Main Functions]
 * 1. countPending
 * 2. MAX_RUN_POLL 타임아웃
 *
 * [Dependencies]
 * wootar:testWooBulkApiStatus.js
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiStatus.js", false);

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

if (String(instance.vars.nextAction) === "finish") {
  logInfo("[StatusDecide] 종료 상태 — 판정 생략");
} else {

  var poll = NUM(instance.vars.pollCount) + 1;
  instance.vars.pollCount = poll;
  var maxRun = NUM(instance.vars.MAX_RUN_POLL, 180);

  var checker = new BulkStatusChecker();
  var left = -1;
  try {
    left = checker.countPending();
  } catch (e) {
    logError("[StatusDecide] pending count 실패: " + (e.message || e));
  }

  instance.vars.pendingLeft = left;
  logInfo("[StatusDecide #" + poll + "] pending=" + left
    + " / last fetched=" + (instance.vars.lastFetched || 0)
    + " complete=" + (instance.vars.lastComplete || 0)
    + " stuck=" + (instance.vars.lastStuck || 0)
    + " fail=" + (instance.vars.lastFailed || 0));

  if (left < 0) {
    instance.vars.nextAction = "working";
    logWarning("[StatusDecide] count 실패 → working (다음 사이클 재시도)");
  } else if (left === 0) {
    instance.vars.nextAction = "finish";
    logInfo("[StatusDecide] 확인 대상 없음 → finish");
  } else if (poll >= maxRun) {
    instance.vars.nextAction = "finish";
    logWarning("[StatusDecide] MAX_RUN_POLL " + maxRun
      + " 도달, 잔여 " + left + "건(incomplete) → finish. 다음 실행에서 이어서");
  } else {
    instance.vars.nextAction = "working";
    logInfo("[StatusDecide] 잔여 " + left + " → working (1m 후 GET)");
  }
}
