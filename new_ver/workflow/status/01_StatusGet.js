/* ============================================================================
 * TBAWStatus / 01_StatusGet (청크 GET + Master 갱신)
 * ============================================================================
 * pending Master 를 oldest 부터 CHUNK_SIZE 건 GET 한다.
 * 제출 success / apiYn / Detail 은 변경하지 않음.
 *
 * [Main Functions]
 * 1. BulkStatusChecker.runChunk
 * 2. 건별 PASS/FAIL 로그
 *
 * [Dependencies]
 * wootar:testWooBulkApiStatus.js
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiStatus.js", false);

if (String(instance.vars.nextAction) === "finish") {
  logInfo("[StatusGet] finish — GET 생략");
} else {

  var checker = new BulkStatusChecker();
  var r = checker.runChunk();
  instance.vars.lastFetched    = r.fetched;
  instance.vars.lastComplete   = r.complete;
  instance.vars.lastStuck      = r.stuck;
  instance.vars.lastIncomplete = r.incomplete;
  instance.vars.lastFailed     = r.failed;

  logInfo("[StatusGet] 청크 fetched=" + r.fetched
    + " complete=" + r.complete
    + " stuck=" + r.stuck
    + " incomplete=" + r.incomplete
    + " fail=" + r.failed);
}
