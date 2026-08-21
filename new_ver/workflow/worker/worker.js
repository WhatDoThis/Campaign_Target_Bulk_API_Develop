/* ============================================================================
 * workflow.worker.worker.js (워커 진입점)
 * ============================================================================
 * TBAW1 ~ TBAW15 동일 코드. Factory 01 의 PostEvent vars 로 라이브러리를 실행한다.
 * 상태 Option 만 쓴다. 토큰·스키마·CUSTOM_ATTR 은 BULK_CFG.
 *
 * 이 WF 는 항상 시작됨(state=11). End 만 두고 complete 로 끄지 말 것.
 * PostEvent complete=false.
 *
 * [Main Functions]
 * 1. report — setOption(optKey, runId|status[|sent|failed])
 * 2. new BulkApiWorker(vars).run() — 예외는 rethrow 하지 않음
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js, setOption(상태 핸드셰이크만)
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

var P = vars;
if (String(P.workerName || "") === "" && typeof instance !== "undefined") {
  P = instance.vars;
}

var workerName = String(P.workerName || "UNKNOWN");
var optKey     = String(P.optKey || ("WORKER_DONE_" + workerName));
var runId      = String(P.runId || "");

function report(status, sent, failed) {
  var val = runId ? (runId + "|" + status) : status;
  if (status === "done") {
    val += "|" + (parseInt(sent, 10) || 0) + "|" + (parseInt(failed, 10) || 0);
  }
  try { setOption(optKey, val, "bulk worker status"); }
  catch (e) { logError("[" + workerName + "] 상태 기록 실패: " + e.message); }
}

try {
  report("running");
  logInfo("[" + workerName + "] Signal 수신 / runId=" + runId
    + " / " + P.ingestYm + " line " + P.lineStart + " ~ " + P.lineEnd
    + " / workerCount=" + P.workerCount);

  if (typeof BulkApiWorker !== "function") {
    throw new Error("라이브러리 로드는 됐으나 BulkApiWorker 미정의 — JS 내부명 확인");
  }

  var worker = new BulkApiWorker(P);
  var r = worker.run();

  if (r.sent === 0 && r.failed > 0) {
    throw new Error("전 건 실패 sent=0 failed=" + r.failed);
  }

  report("done", r.sent, r.failed);
  logInfo("[" + workerName + "] 종료 — 성공 " + r.sent + "건 / 실패 " + r.failed + "건");

} catch (e) {
  report("error");
  logError("[" + workerName + "] 중단: " + (e && e.message ? e.message : String(e)));
}
