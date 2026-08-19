// ============================================================
// 워커 실행 스크립트 — TBAW1 ~ TBAW5 전부 동일 코드
// 배치: [signalTBAWn] → [jsTBAWn] → [End]
//
// 워커별로 다른 것은 코드가 아니라 다음 두 가지뿐이다.
//   1) 워크플로우 내부명      : TBAW1 ~ TBAW5
//   2) 시그널 활동 내부명     : signalTBAW1 ~ signalTBAW5
// 실행 파라미터(workerName / uidStart / uidEnd / optKey / runId)는
// Distributor가 PostEvent로 주입한다.
// ============================================================

loadLibrary("wootar:testWooBulkApiWorker.js", false);

var workerName = String(vars.workerName || "UNKNOWN");
// optKey 미수신 시 기존 규칙으로 폴백 (Distributor 구버전 호환)
var optKey = String(vars.optKey || ("WORKER_DONE_" + workerName));

function report(status) {
  try { setOption(optKey, status, "bulk worker status"); }
  catch (e) { logError("[" + workerName + "] 상태 기록 실패: " + e.message); }
}

try {
  // 시그널 수신 즉시 running 기록.
  // 이 한 줄이 없으면 Polling이 'ready' 상태로 오해해
  // MaxReadyPoll 초과 시 정상 워커를 signal timeout으로 처리한다.
  report("running");
  logInfo("[" + workerName + "] Signal 수신 / runId=" + vars.runId
    + " / " + vars.uidStart + " ~ " + vars.uidEnd);

  var worker = new BulkApiWorker(vars);
  var r = worker.run();

  report("done");
  logInfo("[" + workerName + "] 종료 — 성공 " + r.sent + "건 / 실패 " + r.failed + "건");

} catch (e) {
  report("error");
  logError("[" + workerName + "] 중단: " + e.message);
  // 의도적으로 재throw하지 않는다.
  // 예외를 올리면 워커 워크플로우가 에러 상태로 정지하고,
  // 다음 라운드의 PostEvent가 큐에만 쌓인 채 처리되지 않아
  // 이후 모든 라운드가 signal timeout으로 실패한다.
  // 실패는 Polling이 옵션값으로 감지한다.
}
