/* ============================================================================
 * workflow.worker.worker.js (워커 진입점)
 * ============================================================================
 * TBAW1 ~ TBAW15 동일 코드. Factory 01 의 PostEvent vars 로 라이브러리를 실행한다.
 * PostEvent: workerName, ingestYmd, bizDate, lineStart, lineEnd, runId, optKey,
 *   workerCount, workerMax, batchSize, customAttr, accountCpm, statusCpm, safetyRatio, staggerSlotMs
 * Target 규격(스키마·토큰·재시도)은 BULK_CFG.
 *
 * 이 WF 는 항상 시작됨(state=11). End 만 두고 complete 로 끄지 말 것.
 * PostEvent complete=false.
 *
 * [Main Functions]
 * 1. resolveSignalParams — PostEvent 필드 명시 추출(for-in 불가 ACC vars 대응)
 * 2. report — setOption(optKey, runId|status[|sent|failed])
 * 3. new BulkApiWorker(params).run()
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js, setOption(상태 핸드셰이크만)
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

function resolveSignalParams(raw, inst) {
  var src = raw;
  if (String(raw.workerName || "") === "" && typeof inst !== "undefined" && inst.vars) {
    src = inst.vars;
  }
  return {
    workerName:     String(src.workerName || "UNKNOWN"),
    ingestYmd:      String(src.ingestYmd || ""),
    bizDate:        String(src.bizDate || ""),
    lineStart:      String(src.lineStart || ""),
    lineEnd:        String(src.lineEnd || ""),
    runId:          String(src.runId || ""),
    optKey:         String(src.optKey || ("WORKER_DONE_" + String(src.workerName || "UNKNOWN"))),
    workerCount:    String(src.workerCount || ""),
    workerMax:      String(src.workerMax || ""),
    batchSize:      String(src.batchSize || ""),
    customAttr:     String(src.customAttr !== undefined && src.customAttr !== null ? src.customAttr : ""),
    accountCpm:     String(src.accountCpm || ""),
    statusCpm:      String(src.statusCpm || ""),
    safetyRatio:    String(src.safetyRatio || ""),
    staggerSlotMs:  String(src.staggerSlotMs || "")
  };
}

var P = resolveSignalParams(vars, (typeof instance !== "undefined") ? instance : null);
var workerName = P.workerName;
var optKey     = P.optKey;
var runId      = P.runId;

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
    + " / bizDate=" + (P.bizDate || P.ingestYmd || "")
    + " / ingestYmd=" + P.ingestYmd
    + " line " + P.lineStart + " ~ " + P.lineEnd
    + " / workerCount=" + P.workerCount
    + " / batchSize=" + P.batchSize);

  if (typeof BulkApiWorker !== "function") {
    throw new Error("라이브러리 로드는 됐으나 BulkApiWorker 미정의 — JS 내부명 확인");
  }

  if (!P.ingestYmd || !P.lineStart || !P.lineEnd) {
    throw new Error("[" + workerName + "] PostEvent 필수 vars 누락"
      + " ingestYmd=" + P.ingestYmd + " line=" + P.lineStart + "~" + P.lineEnd);
  }

  var worker = new BulkApiWorker(P);
  logInfo("[" + workerName + "] 시작 준비 / DRY_RUN=" + worker.DRY_RUN
    + " / batch " + worker.BATCH_SIZE
    + " / custom=" + (worker.customAttrs && worker.customAttrs.length
      ? worker.customAttrs.join(",") : "(none)")
    + " / 스로틀 ~" + worker.MIN_INTERVAL_MS + "ms");

  var r = worker.run();

  if (r.sent === 0 && r.failed > 0) {
    throw new Error("전 건 실패 sent=0 failed=" + r.failed);
  }

  report("done", r.sent, r.failed);
  logInfo("[" + workerName + "] 종료 — 성공 " + r.sent + "건 / 실패 " + r.failed
    + "건 / 배치 " + (r.batches || 0) + "회");

} catch (e) {
  report("error");
  logError("[" + workerName + "] 중단: " + (e && e.message ? e.message : String(e)));
}
