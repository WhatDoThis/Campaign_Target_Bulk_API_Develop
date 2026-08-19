/* ============================================================================
 * TBAWSmokeSignal / jsWorker
 * TBAWSmoke 의 03_Fire 가 PostEvent 로 발사한 시그널을 받아 워커를 실행한다.
 * 운영 워커 워크플로우(TBAW1~5)의 트리거 스크립트와 동일한 계약으로 동작한다.
 *
 * [주의] 이 WF는 항상 '시작됨' 상태로 대기해야 한다. 뒤에 종료 활동을 붙이면
 *        완료 상태로 전환되어 다음 시그널을 받지 못한다.
 * ==========================================================================*/

logInfo(">>> jsWorker 진입");   // ★ 시그널 수신 자체를 먼저 증명

/* --- 파라미터 수신 경로 확인 -------------------------------------------
 * ACC 버전에 따라 vars / instance.vars 둘 중 하나로 들어온다.
 * 여기서 확정한 결과를 운영 워커 5개에 그대로 적용한다.
 * ----------------------------------------------------------------------*/
try { logInfo("  vars          = " + vars.toXMLString()); } catch (e) { logInfo("  vars 접근 불가: " + e.message); }
try { logInfo("  instance.vars = " + instance.vars.toXMLString()); } catch (e) { logInfo("  instance.vars 접근 불가: " + e.message); }

var P = vars;
if (String(P.workerName || "") === "" && typeof instance !== "undefined") {
  logInfo("  vars 에 workerName 없음 → instance.vars 로 대체");
  P = instance.vars;
}

var workerName = String(P.workerName || "SMOKE");
var optKey     = String(P.optKey || ("WORKER_DONE_" + workerName));
function report(st) {
  setOption(optKey, st, "smoke worker status");
  logInfo("  [보고] " + optKey + " = " + st);
}

try {
  report("running");

  loadLibrary("wootar:testWooBulkApiWorker.js", false);
  if (typeof BulkApiWorker !== "function") {
    throw new Error("라이브러리 로드는 됐으나 BulkApiWorker 미정의 — JS 코드 내부명 확인");
  }
  logInfo("  라이브러리 로드 OK");

  var w = new BulkApiWorker(P);
  logInfo("  워커 생성 OK / DRY_RUN=" + w.DRY_RUN
        + " / 구간 " + w.uidStart + "~" + w.uidEnd
        + " / batch " + w.BATCH_SIZE
        + " / url " + w.bulkApiUrl);

  // 라이브러리 단위 자가 점검
  var seg = w.generateSegId();
  var n = seg.split("|").length;
  if (n < w.SEG_MIN || n > w.SEG_MAX) throw new Error("segId 개수 범위 이탈: " + n);
  if (seg.length > w.SEG_MAX_LEN)     throw new Error("segId 길이 초과: " + seg.length);
  logInfo("  segId 샘플 " + n + "개 / " + seg.length + "자");

  var r = w.run();
  logInfo("  run 결과 " + r.sent + "건 / " + r.batches + "배치 / 실패 " + r.failed + "건");
  report("done");

} catch (e) {
  logError("  실패: " + e.message);
  report("error");
}
logInfo("<<< jsWorker 종료");
