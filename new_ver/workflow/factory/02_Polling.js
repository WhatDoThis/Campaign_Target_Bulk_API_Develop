/* ============================================================================
 * TBAWFactory / 02_Polling (워커 완료 감지)
 * ============================================================================
 * Option: {runId}|status 또는 {runId}|done|{sent}|{failed}
 * sent 는 큐 행 수. UID 구간과 무관.
 * nextAction: working | next | finish  (03_Test 가 이 문자열을 본다)
 *
 * getOption 2번째 인자는 false (캐시 stale 방지). 설정 조회가 아니라 상태만.
 *
 * [Main Functions]
 * 1. 워커별 Option 파싱 (STRICT runId)
 * 2. ready 타임아웃 / 라운드 타임아웃
 * 3. 누적 sent 로 GrandTotal 판정
 *
 * [Dependencies]
 * getOption(상태 핸드셰이크만)
 * ==========================================================================*/

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

if (String(instance.vars.nextAction) === "finish") {
  logInfo("[Polling] 종료 상태 — 폴링 생략");
} else {

  var W_COUNT     = NUM(instance.vars.WORKER_COUNT, 5);
  var OPT_PREFIX  = String(instance.vars.OPT_PREFIX);
  var RUN_ID      = String(instance.vars.runId || "");
  var STRICT      = (String(instance.vars.STRICT_RUNID) === "true");
  var ABORT_ERR   = (String(instance.vars.ABORT_ON_WORKER_ERROR) === "true");
  var MAX_READY   = NUM(instance.vars.MAX_READY_POLL, 5);
  var MAX_RUN     = NUM(instance.vars.MAX_RUN_POLL, 360);
  var GRAND_TOTAL = NUM(instance.vars.GRAND_TOTAL, 0);

  var poll = NUM(instance.vars.pollCount) + 1;
  instance.vars.pollCount = poll;

  var pending = 0;   // 아직 끝나지 않은 워커 수. 0 이면 라운드 완료
  var errors  = [];
  var summary = [];
  var sentSum = 0;   // 이번 라운드 done 워커의 sent 합. skip/error 는 0

  // # 1. [Parse] 워커 1..W_COUNT 전부 본다. skip 포함해야 잔존 done 을 오인하지 않음.
  var w;
  for (w = 1; w <= W_COUNT; w++) {
    var wName  = String(instance.vars.WORKER_NAME_TPL).replace("{n}", String(w));
    var optKey = OPT_PREFIX + wName;
    var raw = "";
    try { raw = String(getOption(optKey, false) || ""); } catch (e) { raw = ""; }

    // parts[0]=runId, [1]=status, [2]=sent, [3]=failed (done 일 때만)
    var parts  = raw.split("|");
    var optRun = (parts.length > 1) ? parts[0] : "";
    var status = (parts.length > 1) ? parts[1] : parts[0];
    var sent   = (parts.length > 2) ? NUM(parts[2], 0) : 0;

    // STRICT: 이전 라운드 Option 이 남아 있으면 완료로 치지 않고 대기.
    if (STRICT && RUN_ID !== "" && optRun !== RUN_ID) {
      summary.push(wName + "=stale(" + (status || "none") + ")");
      pending++;
      continue;
    }

    summary.push(wName + "=" + (status || "none") + (sent ? ":" + sent : ""));

    if (status === "done" || status === "skip") {
      instance.vars["readyRetry_" + w] = 0;
      if (status === "done") sentSum += sent;
    } else if (status === "error") {
      // pending 에 넣지 않음 → 라운드는 진행. 실패 행은 apiYn=N 유지
      errors.push(wName);
    } else if (status === "ready") {
      // 시그널은 갔으나 워커가 running 으로 안 바꿈. WF 미수신/정지 가능성.
      var rc = NUM(instance.vars["readyRetry_" + w]) + 1;
      instance.vars["readyRetry_" + w] = rc;
      if (rc >= MAX_READY) {
        errors.push(wName + "(signal timeout " + rc + ")");
      } else {
        pending++;
      }
    } else {
      // running / 빈 값 / 기타 → 진행 중
      instance.vars["readyRetry_" + w] = 0;
      pending++;
    }
  }

  logInfo("[Polling #" + poll + "] " + summary.join(", "));

  // # 2. [Timeout] 라운드가 MAX_RUN 을 넘기면 남은 pending 을 끊고 에러 목록에 넣는다.
  if (pending > 0 && poll >= MAX_RUN) {
    errors.push("ROUND_TIMEOUT(poll " + poll + ")");
    pending = 0;
  }

  if (errors.length > 0) {
    var msg = "[Polling] 워커 이상: " + errors.join(", ");
    if (ABORT_ERR) {
      logError(msg + " → 워크플로우 중단");
      throw new Error(msg);
    }
    logWarning(msg + " → 제외하고 계속 (apiYn=N 잔여는 다음 라운드)");
  }

  // # 3. [Next] pending>0 이면 Wait 후 재폴링. 아니면 sent 누적 후 next/finish.
  if (pending > 0) {
    instance.vars.nextAction = "working";
    logInfo("[Polling] 진행 중 (" + pending + "개 대기)");
  } else {
    var processed = NUM(instance.vars.globalProcessed) + sentSum;
    instance.vars.globalProcessed = processed;
    logInfo("=== Round " + instance.vars.round + " 완료 / 이번 sent="
      + sentSum + " / 누적 " + processed + "건 ===");

    if (GRAND_TOTAL > 0 && processed >= GRAND_TOTAL) {
      instance.vars.nextAction = "finish";
      logInfo("[Polling] 전체 상한(" + GRAND_TOTAL + ") 도달 → finish");
    } else {
      instance.vars.nextAction = "next";
      logInfo("[Polling] 다음 라운드");
    }
  }
}
