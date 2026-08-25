/* ============================================================================
 * TBAWFactory / 00_Config (Factory 설정)
 * ============================================================================
 * 연동 값은 BULK_CFG. 라운드·폴링·WF 이름·BIZ_DATE·GRAND_TOTAL.
 *
 * 캔버스:
 *   Start → 00 → 01 → 02 → 03_Test
 *     Test working → Wait 15s → 02
 *     Test next    → 01
 *     Test finish  → End (+ Status Signal PostEvent)
 *
 * [Main Functions]
 * 1. FACTORY_CFG — GRAND_TOTAL·BIZ_DATE·폴링·WF 이름
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

  // 0 = 해당 BIZ_DATE pending 전량(누적 sent 상한 없음). Default.
  // 양수 = 누적 sent cap — 부분 전송·부하 테스트 시 수기 입력 (예: 10000)
  GRAND_TOTAL   : 0,

  // 적재 기준일 YYYYMMDD. "" → BULK_CFG.BIZ_DATE → 없으면 오늘.
  // "20260824" → hardcode — 비오늘·누락분(apiYn=N) 재전송
  BIZ_DATE      : "",

  WORKER_WF     : "TBAW{n}",
  WORKER_NAME   : "TBAW{n}",
  WORKER_SIG    : "sigWorker",

  OPT_PREFIX    : "WORKER_DONE_",
  STRICT_RUNID  : true,
  ABORT_ON_ERR  : false,
  MAX_READY     : 5,
  MAX_RUN       : 360,
  MAX_ROUND     : 200,
  MAX_STALL     : 3,
  STAGGER_POST  : 300,
  POLL_WAIT_SEC : 15
};

if (typeof BULK_CFG === "undefined" || typeof BulkApiWorker !== "function") {
  throw new Error("[Config] wootar:testWooBulkApiWorker.js 로드 실패");
}

function sqlLitCfg(s) {
  return String(s === undefined || s === null ? "" : s).replace(/'/g, "''");
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

var throttleMs = BulkApiWorker.calcThrottleMs(wCount);

var bizDateOverride = String(FACTORY_CFG.BIZ_DATE || "").replace(/^\s+|\s+$/g, "");
var bizDate = BulkApiWorker.resolveBizDate(bizDateOverride || undefined);
if (!/^[0-9]{8}$/.test(bizDate)) {
  throw new Error("[Config] BIZ_DATE 형식 오류(YYYYMMDD 8자리): " + bizDate);
}

var grandTotal = parseInt(FACTORY_CFG.GRAND_TOTAL, 10);
if (isNaN(grandTotal) || grandTotal < 0) grandTotal = 0;

var roundLimit = parseInt(FACTORY_CFG.ROUND_LIMIT, 10);
if (!(roundLimit >= 1)) {
  roundLimit = (grandTotal > 0) ? grandTotal : 50000000;
}

var pendingXPath = "@apiYn = 'N' AND @lineNo >= 1 AND @ingestYmd = '" + bizDate + "'";
var pendingSql   = "s.sapiyn = 'N' AND s.singestymd = '" + sqlLitCfg(bizDate) + "'";

instance.vars.MEMBER_SCHEMA   = schema;
instance.vars.MEMBER_ELEMENT  = String(BULK_CFG.MEMBER_ELEMENT || schema.split(":")[1]);
instance.vars.MEMBER_TABLE    = String(BULK_CFG.MEMBER_TABLE || "");
instance.vars.BIZ_DATE        = bizDate;
instance.vars.PENDING_COND     = pendingXPath;
instance.vars.PENDING_COND_SQL = pendingSql;
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
instance.vars.MAX_ROUND       = parseInt(FACTORY_CFG.MAX_ROUND, 10) || 200;
instance.vars.MAX_STALL       = parseInt(FACTORY_CFG.MAX_STALL, 10) || 3;
instance.vars.STAGGER_POST_MS = parseInt(FACTORY_CFG.STAGGER_POST, 10) || 0;
instance.vars.POLL_WAIT_SEC   = parseInt(FACTORY_CFG.POLL_WAIT_SEC, 10) || 15;
instance.vars.round           = 0;
instance.vars.globalProcessed = 0;
instance.vars.pollCount       = 0;
instance.vars.nextAction      = "";
instance.vars.prevProcessed   = -1;
instance.vars.stallCount      = 0;

logInfo("[Config] BIZ_DATE=" + bizDate
  + (bizDateOverride ? " (hardcode)" : " (auto)")
  + " / 워커 " + wCount + "/" + wMax
  + " / batch " + batch
  + " / roundLimit " + instance.vars.ROUND_LIMIT
  + " / grandTotal " + instance.vars.GRAND_TOTAL
  + (grandTotal === 0 ? " (무제한)" : " (cap)")
  + " / pollWait " + instance.vars.POLL_WAIT_SEC + "s"
  + " / 스로틀 ~" + throttleMs + "ms"
  + " / schema " + schema);
