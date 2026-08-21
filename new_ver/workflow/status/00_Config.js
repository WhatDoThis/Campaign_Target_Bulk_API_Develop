/* ============================================================================
 * TBAWStatus / 00_Config (적재 상태 재조회 설정)
 * ============================================================================
 * 전송이 끝난 뒤 1~2시간 후에 이 WF 를 돌린다. 토큰·스키마는 BULK_CFG.
 * xtk:option 은 쓰지 않음.
 *
 * 캔버스:
 *   Start → 00 → 01_StatusGet → 02_Decide → 03_Test
 *     Test working → 1m Wait → 01
 *     Test finish  → End
 *
 * [Main Functions]
 * 1. STATUS_CFG / BULK_CFG 정합
 * 2. instance.vars 전파
 *
 * [Dependencies]
 * wootar:testWooBulkApiStatus.js
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiStatus.js", false);

if (typeof STATUS_CFG === "undefined" || typeof BulkStatusChecker !== "function") {
  throw new Error("[StatusConfig] wootar:testWooBulkApiStatus.js 로드 실패");
}
if (typeof BULK_CFG === "undefined") {
  throw new Error("[StatusConfig] BULK_CFG 없음 — 전송 라이브러리 게시 확인");
}

var chunk = parseInt(STATUS_CFG.CHUNK_SIZE, 10) || 20;
if (chunk < 1) chunk = 1;
if (chunk > 100) chunk = 100;

instance.vars.STATUS_CHUNK   = chunk;
instance.vars.MAX_RUN_POLL   = parseInt(STATUS_CFG.MAX_RUN_POLL, 10) || 180;
instance.vars.pollCount      = 0;
instance.vars.nextAction     = "";

var cpm = (BULK_CFG.ACCOUNT_CPM * BULK_CFG.SAFETY_RATIO);
var throttleMs = Math.ceil(60000 / (cpm > 0 ? cpm : 1));

logInfo("[StatusConfig] chunk=" + chunk
  + " / maxPoll=" + instance.vars.MAX_RUN_POLL
  + " / 스로틀 ~" + throttleMs + "ms"
  + " / stuckAfter=" + STATUS_CFG.STUCK_AFTER_HOURS + "h"
  + " / schema " + BULK_CFG.MASTER_SCHEMA);
