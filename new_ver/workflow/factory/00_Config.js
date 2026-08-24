/* ============================================================================
 * TBAWFactory / 00_Config (Factory 설정)
 * ============================================================================
 * 연동 값은 BULK_CFG. 라운드·폴링·WF 이름만.
 *
 * 캔버스:
 *   Start → 00 → 01 → 02 → 03_Test
 *     Test working → Wait 15s → 02
 *     Test next    → 01
 *     Test finish  → End (+ Status Signal PostEvent)
 *
 * [Main Functions]
 * 1. FACTORY_CFG — GRAND_TOTAL·폴링·WF 이름
 * 2. BULK_CFG 정합
 * 3. instance.vars 전파
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

var FACTORY_CFG = {

  // 0 = GRAND_TOTAL 과 동일(단일 라운드)
  ROUND_LIMIT   : 0,
  GRAND_TOTAL   : 50000000,

  WORKER_WF     : "TBAW{n}",
  WORKER_NAME   : "TBAW{n}",
  WORKER_SIG    : "sigWorker",

  OPT_PREFIX    : "WORKER_DONE_",
  STRICT_RUNID  : true,
  ABORT_ON_ERR  : false,
  MAX_READY     : 5,
  MAX_RUN       : 360,
  // (변경) 라운드 가드 값 Config 이관. MAX_READY/MAX_RUN 과 동일 규약
  MAX_ROUND     : 200,        // 무한 라운드 상한 (FIX-20-C)
  MAX_STALL     : 3,          // 연속 무진행 라운드 허용치 (FIX-25)
  STAGGER_POST  : 300,
  POLL_WAIT_SEC : 15          // 캔버스 Wait 활동과 동일하게 수동 변경
};

if (typeof BULK_CFG === "undefined" || typeof BulkApiWorker !== "function") {
  throw new Error("[Config] wootar:testWooBulkApiWorker.js 로드 실패");
}

var lineMax = parseInt(BULK_CFG.LINE_NO_MAX, 10);
if (!(lineMax >= 1)) {
  throw new Error("[Config] BULK_CFG.LINE_NO_MAX 없음");
}

var wCount = parseInt(BULK_CFG.WORKER_COUNT, 10) || 3;
var wMax   = parseInt(BULK_CFG.WORKER_MAX, 10) || 15;
if (wCount < 1) wCount = 1;
if (wCount > wMax) {
  logWarning("[Config] WORKER_COUNT " + wCount + " > WORKER_MAX " + wMax);
  wCount = wMax;
}

var schema = String(BULK_CFG.MEMBER_SCHEMA || "");
if (schema.indexOf(":") < 0) {
  throw new Error("[Config] MEMBER_SCHEMA 형식 오류: '" + schema + "'");
}

var batch = parseInt(BULK_CFG.BATCH_SIZE, 10) || 5000;
if (batch < 1) batch = 1;
if (batch > parseInt(BULK_CFG.MAX_BATCH_ROWS, 10)) {
  throw new Error("[Config] BATCH_SIZE " + batch + " > Target 상한");
}

var throttleMs = BulkApiWorker.calcThrottleMs(wCount);   // 워커와 동일 스로틀 공식

var grandTotal = parseInt(FACTORY_CFG.GRAND_TOTAL, 10) || 0;
var roundLimit = parseInt(FACTORY_CFG.ROUND_LIMIT, 10);
if (!(roundLimit >= 1)) {
  roundLimit = (grandTotal > 0) ? grandTotal : 50000000;
}

instance.vars.MEMBER_SCHEMA   = schema;
instance.vars.MEMBER_ELEMENT  = String(BULK_CFG.MEMBER_ELEMENT || schema.split(":")[1]);
instance.vars.MEMBER_TABLE    = String(BULK_CFG.MEMBER_TABLE || "");
// (변경) pending 조건 이중 정의 방지. XPath(queryDef용) / SQL(sqlSelect용) 쌍으로 관리
// PENDING_COND_SQL 은 Config 상수만 설정. 외부 입력·vars 조작 금지 — SQL 직접 삽입
// 둘 중 하나만 바뀌면 분배와 폴링이 어긋나므로 반드시 같이 수정할 것
instance.vars.PENDING_COND     = "@apiYn = 'N' AND @lineNo >= 1 AND @ingestYm != ''";
instance.vars.PENDING_COND_SQL = "s.sapiyn = 'N'";
instance.vars.WORKER_COUNT    = wCount;
instance.vars.ROUND_LIMIT     = roundLimit;
instance.vars.GRAND_TOTAL     = grandTotal;
instance.vars.WORKER_WF_TPL   = String(FACTORY_CFG.WORKER_WF);
instance.vars.WORKER_NAME_TPL = String(FACTORY_CFG.WORKER_NAME);
instance.vars.WORKER_SIG      = String(FACTORY_CFG.WORKER_SIG || "sigWorker");
instance.vars.OPT_PREFIX      = String(FACTORY_CFG.OPT_PREFIX || "WORKER_DONE_");
instance.vars.STRICT_RUNID    = FACTORY_CFG.STRICT_RUNID ? "true" : "false";
instance.vars.ABORT_ON_WORKER_ERROR = FACTORY_CFG.ABORT_ON_ERR ? "true" : "false";
instance.vars.MAX_READY_POLL  = parseInt(FACTORY_CFG.MAX_READY, 10) || 5;
instance.vars.MAX_RUN_POLL    = parseInt(FACTORY_CFG.MAX_RUN, 10) || 360;
// (변경) MAX_ROUND / MAX_STALL Config 이관 — FIX-27
instance.vars.MAX_ROUND       = parseInt(FACTORY_CFG.MAX_ROUND, 10) || 200;
instance.vars.MAX_STALL       = parseInt(FACTORY_CFG.MAX_STALL, 10) || 3;
instance.vars.STAGGER_POST_MS = parseInt(FACTORY_CFG.STAGGER_POST, 10) || 0;
instance.vars.POLL_WAIT_SEC   = parseInt(FACTORY_CFG.POLL_WAIT_SEC, 10) || 15;
instance.vars.round           = 0;
instance.vars.globalProcessed = 0;
instance.vars.pollCount       = 0;
instance.vars.nextAction      = "";
// (변경) 무진행 감지용 — FIX-25 라운드 stall
instance.vars.prevProcessed   = -1;
instance.vars.stallCount      = 0;

logInfo("[Config] 워커 " + wCount + "/" + wMax
  + " / batch " + batch
  + " / roundLimit " + instance.vars.ROUND_LIMIT
  + " / grandTotal " + instance.vars.GRAND_TOTAL
  + " / pollWait " + instance.vars.POLL_WAIT_SEC + "s"
  + " / 스로틀 ~" + throttleMs + "ms"
  + " / schema " + schema);
