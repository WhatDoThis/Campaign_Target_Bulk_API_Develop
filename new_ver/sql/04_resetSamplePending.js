/* ============================================================================
 * sql.04_resetSamplePending (Sample 전송 상태 롤백)
 * ============================================================================
 * Factory/워커 테스트 후 Sample 을 pending(apiYn=N, imasterid=0) 으로 되돌린다.
 * Master 삭제는 별도 Update 컴포넌트 — 본 스크립트 Scope 제외.
 *
 * [Main Functions]
 * 1. YMD·CHUNK 설정
 * 2. sapiyn='Y' 행만 LIMIT 배치 UPDATE (변경분만 터치)
 * 3. imasterid>0 잔여(N+FK) 2차 정리
 *
 * [Dependencies]
 * sqlExec, logInfo, BULK_CFG.MEMBER_TABLE(선택)
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

/* --- 설정 --------------------------------------------------------------- */
var RESET_YMD   = "20260824";   // Factory BIZ_DATE 와 동일
var CHUNK       = 50000;        // 배치당 UPDATE 행 수
var MAX_BATCH   = 500;          // 무한루프 가드 (500 x 5만 = 2천5백만)
var RESET_FK    = true;         // apiYn=N 이나 imasterid>0 인 행 FK 해제

var TABLE = (typeof BULK_CFG !== "undefined" && BULK_CFG.MEMBER_TABLE)
  ? String(BULK_CFG.MEMBER_TABLE)
  : "wootartestwootargetsample";

function sqlLitReset(s) {
  return String(s === undefined || s === null ? "" : s).replace(/'/g, "''");
}

function resetSentBatch(ymd, chunk, maxBatch) {
  var total = 0;
  var batch = 0;
  var t0 = new Date().getTime();
  var ymdLit = sqlLitReset(ymd);

  while (batch++ < maxBatch) {
    var sql =
      "UPDATE " + TABLE + " SET sapiyn='N', imasterid=0 "
      + "WHERE iid IN ("
      + "  SELECT iid FROM " + TABLE
      + "  WHERE singestymd='" + ymdLit + "' AND sapiyn='Y'"
      + "  LIMIT " + chunk
      + ")";

    var n = parseInt(sqlExec(sql), 10) || 0;
    total += n;
    if (n === 0) break;

    if (batch === 1 || batch % 10 === 0) {
      logInfo("[reset] sent batch=" + batch + " +" + n + " total=" + total
        + " elapsed=" + Math.round((new Date().getTime() - t0) / 1000) + "s");
    }
  }

  if (batch >= maxBatch) {
    logWarning("[reset] MAX_BATCH(" + maxBatch + ") 도달 — sapiyn=Y 잔여 확인");
  }
  return total;
}

function resetOrphanFk(ymd, chunk, maxBatch) {
  var total = 0;
  var batch = 0;
  var t0 = new Date().getTime();
  var ymdLit = sqlLitReset(ymd);

  while (batch++ < maxBatch) {
    var sql =
      "UPDATE " + TABLE + " SET imasterid=0 "
      + "WHERE iid IN ("
      + "  SELECT iid FROM " + TABLE
      + "  WHERE singestymd='" + ymdLit + "' AND sapiyn='N' AND imasterid > 0"
      + "  LIMIT " + chunk
      + ")";

    var n = parseInt(sqlExec(sql), 10) || 0;
    total += n;
    if (n === 0) break;

    if (batch === 1 || batch % 10 === 0) {
      logInfo("[reset] fk batch=" + batch + " +" + n + " total=" + total
        + " elapsed=" + Math.round((new Date().getTime() - t0) / 1000) + "s");
    }
  }
  return total;
}

logInfo("[reset] START ymd=" + RESET_YMD + " table=" + TABLE + " chunk=" + CHUNK);

var sentTotal = resetSentBatch(RESET_YMD, CHUNK, MAX_BATCH);
logInfo("[reset] apiYn=Y → N 완료 rows=" + sentTotal);

var fkTotal = 0;
if (RESET_FK) {
  fkTotal = resetOrphanFk(RESET_YMD, CHUNK, MAX_BATCH);
  logInfo("[reset] orphan FK 해제 rows=" + fkTotal);
}

logInfo("[reset] DONE sent=" + sentTotal + " fk=" + fkTotal
  + " — Master 삭제는 Update 컴포넌트 별도 실행");
