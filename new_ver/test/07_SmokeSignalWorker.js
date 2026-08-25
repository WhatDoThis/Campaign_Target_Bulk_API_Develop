/* ============================================================================
 * TBAWSmokeSignal / jsWorker (워커 진입점)
 * 03_Fire PostEvent 를 받아 BulkApiWorker.run() 을 실행한다.
 * Factory worker.js 와 동일 vars 계약(workerName, ingestYmd, bizDate, lineStart, lineEnd, runId, optKey).
 *
 * [주의] 이 WF는 항상 '시작됨'. 뒤에 End만 두고 완료로 끄지 말 것.
 *
 * [Main Functions]
 * 1. vars 수신 (없으면 instance.vars)
 * 2. setOption(optKey, runId|status)
 * 3. new BulkApiWorker(p).run()
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js, setOption(상태만)
 * ==========================================================================*/

logInfo(">>> jsWorker 진입");

function dumpVars(label, o) {
  var a = [];
  for (var k in o) { a.push(k + "=" + String(o[k])); }
  logInfo("  " + label + " = " + (a.length ? a.join(" | ") : "(비어있음)"));
}
dumpVars("vars", vars);
if (typeof instance !== "undefined" && instance.vars) dumpVars("instance.vars", instance.vars);

var P = vars;
if (String(P.workerName || "") === "" && typeof instance !== "undefined") {
  logInfo("  vars 에 workerName 없음 → instance.vars 로 대체");
  P = instance.vars;
}

var workerName = String(P.workerName || "SMOKE");
var optKey     = String(P.optKey || ("WORKER_DONE_" + workerName));
var runId      = String(P.runId || "");

function report(st) {
  var val = runId ? (runId + "|" + st) : st;
  try { setOption(optKey, val, "smoke worker status"); }
  catch (e) { logError("[" + workerName + "] 상태 기록 실패: " + e.message); }
  logInfo("  [보고] " + optKey + " = " + val);
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
        + " / 구간 " + w.ingestYmd + " line " + w.lineStart + "~" + w.lineEnd
        + " / batch " + w.BATCH_SIZE
        + " / custom=" + (w.customAttrs && w.customAttrs.length ? w.customAttrs.join(",") : "(none)")
        + " / url " + w.bulkApiUrl);

  var r = w.run();
  logInfo("  run 결과 " + r.sent + "건 / " + r.batches + "배치 / 실패 " + r.failed + "건");
  if (r.sent === 0 && r.failed > 0) {
    throw new Error("전 건 실패 sent=0 failed=" + r.failed);
  }
  report("done");

} catch (e) {
  logError("  실패: " + (e && e.message ? e.message : String(e)));
  report("error");
}
logInfo("<<< jsWorker 종료");
