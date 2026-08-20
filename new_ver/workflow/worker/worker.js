/* ============================================================================
 * workflow.worker.worker.js (워커 진입점)
 * ============================================================================
 * TBAW1 ~ TBAW15 동일 코드. Factory 01 의 PostEvent vars 로 라이브러리를 실행한다.
 * 상태 Option 만 쓴다. 토큰·스키마·CUSTOM_ATTR 은 BULK_CFG 또는 시그널.
 *
 * 이 WF 는 항상 시작됨(state=11). End 만 두고 complete 로 끄지 말 것.
 * PostEvent complete=false. true 면 한 번 돌고 꺼져 다음 라운드 시그널을 못 받는다.
 *
 * [Main Functions]
 * 1. report — setOption(optKey, runId|status[|sent|failed])
 * 2. new BulkApiWorker(vars).run() — 예외는 rethrow 하지 않음
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js, setOption(상태 핸드셰이크만)
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

// PostEvent 는 vars. 비어 있으면 instance.vars (스모크 07 과 같은 폴백).
var P = vars;
if (String(P.workerName || "") === "" && typeof instance !== "undefined") {
  P = instance.vars;
}

var workerName = String(P.workerName || "UNKNOWN");
var optKey     = String(P.optKey || ("WORKER_DONE_" + workerName));
var runId      = String(P.runId || "");

// # 1. report
// 형식: {runId}|running | {runId}|error | {runId}|done|{sent}|{failed}
// 02_Polling 은 | 로 나눠 [1]=status, [2]=sent. runId 가 빠지면 STRICT 에서 stale.
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
    + " / " + P.uidStart + " ~ " + P.uidEnd
    + " / dryRun=" + P.dryRun
    + " / workerCount=" + P.workerCount);

  if (typeof BulkApiWorker !== "function") {
    throw new Error("라이브러리 로드는 됐으나 BulkApiWorker 미정의 — JS 내부명 확인");
  }

  // # 2. run — p 는 시그널 전체. uidStart/uidEnd 없으면 생성자가 throw.
  var worker = new BulkApiWorker(P);
  var r = worker.run();

  // urlPermission(JST-310026) 등으로 전 건 실패하면 sent=0. done 으로 보고하면
  // Factory 가 성공으로 오인한다. error 로 바꿔 02 가 목록에 남긴다.
  if (r.sent === 0 && r.failed > 0) {
    throw new Error("전 건 실패 sent=0 failed=" + r.failed);
  }

  report("done", r.sent, r.failed);
  logInfo("[" + workerName + "] 종료 — 성공 " + r.sent + "건 / 실패 " + r.failed + "건");

} catch (e) {
  // rethrow 하지 않음. 워커 WF 가 Error 로 멈추면 다음 PostEvent 가 큐에만 쌓인다.
  report("error");
  logError("[" + workerName + "] 중단: " + (e && e.message ? e.message : String(e)));
}
