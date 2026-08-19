// 라이브러리 로드
loadLibrary("lgu:bulkApiWorker", false);

var workerName = vars.workerName || "unknown";

try {
  setOption("WORKER_DONE_" + workerName, "running");
  logInfo("[" + workerName + "] Signal 수신 → running");

  // UID 범위로 인스턴스 생성 (숫자 offset 대신)
  var worker = new BulkApiWorker(
    vars.uidStart,
    vars.uidEnd,
    workerName
  );
  if (vars.batchSize) {
    worker.BATCH_SIZE = parseInt(vars.batchSize);
  }
  worker.run();

  setOption("WORKER_DONE_" + workerName, "done");

} catch (e) {
  setOption("WORKER_DONE_" + workerName, "error");
  logError("[" + workerName + "] 에러: " + e.message);
}


