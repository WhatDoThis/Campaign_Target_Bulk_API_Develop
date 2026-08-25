/* ============================================================================
 * TBAWFactory / 00_Config (Factory 설정)
 * ============================================================================
 * 연동 값: FACTORY_CFG(배분·레이트·라운드) + BULK_CFG(스키마·Target 규격).
 *
 * 캔버스:
 *   Start → 00 → 01 → 02 → 03_Test
 *     Test working → Wait 15s → 02
 *     Test next    → 01
 *     Test finish  → End (+ Status Signal PostEvent)
 *
 * [Main Functions]
 * 1. FACTORY_CFG — WORKER/BATCH/CUSTOM_ATTR·GRAND_TOTAL·BIZ_DATE·폴링
 * 2. BULK_CFG 정합·MEMBER_TABLE·pending 시작 건수
 * 3. instance.vars 전파·sessionRunId
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

var FACTORY_CFG = {

  /* ---- 라운드 스코프 ---- */
  ROUND_LIMIT   : 2000000,
  GRAND_TOTAL   : 10000000,
  // 적재 기준일 YYYYMMDD. "" → 오늘. "20260824" → hardcode 재전송
  BIZ_DATE      : "",

  /* ---- 워커 배분 ---- */
  WORKER_COUNT  : 3,
  WORKER_MAX    : 15,
  BATCH_SIZE    : 50000,

  /* ---- 전송 속성 ---- */
  CUSTOM_ATTR   : "@planName",

  /* ---- 레이트 예산 ---- */
  ACCOUNT_CPM     : 50,
  STATUS_CPM      : 5,
  SAFETY_RATIO    : 0.9,
  STAGGER_SLOT_MS : 1200,

  /* ---- WF 배선 ---- */
  WORKER_WF     : "TBAW{n}",
  WORKER_NAME   : "TBAW{n}",
  WORKER_SIG    : "sigWorker",
  OPT_PREFIX    : "WORKER_DONE_",

  /* ---- 폴링 런타임 ---- */
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

function cfgInt(v, d) {
  var n = parseInt(v, 10);
  return (!isNaN(n) && n > 0) ? n : d;
}

var lineMax = parseInt(BULK_CFG.LINE_NO_MAX, 10);
if (!(lineMax >= 1)) {
  throw new Error("[Config] BULK_CFG.LINE_NO_MAX 없음");
}

var wCount = cfgInt(FACTORY_CFG.WORKER_COUNT, 3);
var wMax   = cfgInt(FACTORY_CFG.WORKER_MAX, 15);
if (wCount < 1) wCount = 1;
if (wCount > wMax) {
  logWarning("[Config] WORKER_COUNT " + wCount + " > WORKER_MAX " + wMax);
  wCount = wMax;
}

var schema = String(BULK_CFG.MEMBER_SCHEMA || "");
if (schema.indexOf(":") < 0) {
  throw new Error("[Config] MEMBER_SCHEMA 형식 오류: '" + schema + "'");
}

var batch = cfgInt(FACTORY_CFG.BATCH_SIZE, 50000);
if (batch > parseInt(BULK_CFG.MAX_BATCH_ROWS, 10)) {
  throw new Error("[Config] BATCH_SIZE " + batch + " > Target 상한");
}

var customAttr = String(FACTORY_CFG.CUSTOM_ATTR || "");

var throttleMs = BulkApiWorker.calcThrottleMs(wCount, {
  ACCOUNT_CPM     : FACTORY_CFG.ACCOUNT_CPM,
  STATUS_CPM      : FACTORY_CFG.STATUS_CPM,
  SAFETY_RATIO    : FACTORY_CFG.SAFETY_RATIO,
  STAGGER_SLOT_MS : FACTORY_CFG.STAGGER_SLOT_MS
});

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

var ROUND_CAP = wCount * batch * 40;
if (roundLimit <= 0 || roundLimit > ROUND_CAP) {
  logWarning("[Config] ROUND_LIMIT " + roundLimit + " → " + ROUND_CAP + " clamp"
    + " (worker " + wCount + " x batch " + batch + " x 40)");
  roundLimit = ROUND_CAP;
}

var pendingXPath = "@apiYn = 'N' AND @lineNo >= 1 AND @ingestYmd = '" + bizDate + "'";
var pendingSql   = "s.sapiyn = 'N' AND s.singestymd = '" + sqlLitCfg(bizDate) + "' AND s.ilineno >= 1";

var memTable = String(BULK_CFG.MEMBER_TABLE || "").replace(/^\s+|\s+$/g, "");
if (!memTable) {
  memTable = "wootartestwootargetsample";
  logWarning("[Config] BULK_CFG.MEMBER_TABLE 비어 있음 — 폴백 " + memTable);
}

var pendingStartCnt = -1;
if (memTable) {
  try {
    var cntRs = sqlSelect("row,@cnt:long",
      "SELECT COUNT(*) AS cnt FROM " + memTable + " s WHERE " + pendingSql);
    if (cntRs && cntRs.row.length() > 0) {
      for each (var crow in cntRs.row) {
        pendingStartCnt = parseInt(String(crow.@cnt || crow.@CNT || 0), 10) || 0;
      }
    }
  } catch (eCnt) {
    logWarning("[Config] pending COUNT 실패(진행 계속): " + (eCnt.message || eCnt));
  }
}

var sessionRunId = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S");

instance.vars.MEMBER_SCHEMA   = schema;
instance.vars.MEMBER_ELEMENT  = String(BULK_CFG.MEMBER_ELEMENT || schema.split(":")[1]);
instance.vars.MEMBER_TABLE    = memTable;
instance.vars.BIZ_DATE        = bizDate;
instance.vars.sessionRunId    = sessionRunId;
instance.vars.pendingStartCnt = pendingStartCnt;
instance.vars.PENDING_COND     = pendingXPath;
instance.vars.PENDING_COND_SQL = pendingSql;
instance.vars.WORKER_COUNT    = wCount;
instance.vars.WORKER_MAX      = wMax;
instance.vars.ROUND_LIMIT     = roundLimit;
instance.vars.GRAND_TOTAL     = grandTotal;
instance.vars.BATCH_SIZE      = batch;
instance.vars.CUSTOM_ATTR     = customAttr;
instance.vars.ACCOUNT_CPM     = cfgInt(FACTORY_CFG.ACCOUNT_CPM, 50);
instance.vars.STATUS_CPM      = cfgInt(FACTORY_CFG.STATUS_CPM, 5);
instance.vars.SAFETY_RATIO    = String(FACTORY_CFG.SAFETY_RATIO || 0.9);
instance.vars.STAGGER_SLOT_MS = cfgInt(FACTORY_CFG.STAGGER_SLOT_MS, 1200);
instance.vars.WORKER_WF_TPL   = String(FACTORY_CFG.WORKER_WF);
instance.vars.WORKER_NAME_TPL = String(FACTORY_CFG.WORKER_NAME);
instance.vars.WORKER_SIG      = String(FACTORY_CFG.WORKER_SIG || "sigWorker");
instance.vars.OPT_PREFIX      = String(FACTORY_CFG.OPT_PREFIX || "WORKER_DONE_");
instance.vars.STRICT_RUNID    = FACTORY_CFG.STRICT_RUNID ? "true" : "false";
instance.vars.ABORT_ON_WORKER_ERROR = String(FACTORY_CFG.ABORT_ON_ERR === true);
instance.vars.MAX_READY_POLL  = parseInt(FACTORY_CFG.MAX_READY, 10) || 5;
instance.vars.MAX_RUN_POLL    = parseInt(FACTORY_CFG.MAX_RUN, 10) || 360;
instance.vars.MAX_ROUND       = parseInt(FACTORY_CFG.MAX_ROUND, 10) || 200;
instance.vars.MAX_STALL       = parseInt(FACTORY_CFG.MAX_STALL, 10) || 3;
instance.vars.STAGGER_POST_MS = parseInt(FACTORY_CFG.STAGGER_POST, 10) || 0;
instance.vars.POLL_WAIT_SEC   = parseInt(FACTORY_CFG.POLL_WAIT_SEC, 10) || 15;
instance.vars.round           = 0;
instance.vars.globalProcessed = 0;
instance.vars.globalFailed    = 0;
instance.vars.pollCount       = 0;
instance.vars.nextAction      = "";
instance.vars.prevProcessed   = -1;
instance.vars.stallCount      = 0;

logInfo("[Config] sessionRunId=" + sessionRunId
  + " / BIZ_DATE=" + bizDate
  + (bizDateOverride ? " (hardcode)" : " (auto)")
  + " / pendingStart=" + (pendingStartCnt >= 0 ? pendingStartCnt : "(조회실패)")
  + " / 워커 " + wCount + "/" + wMax
  + " / batch " + batch
  + " / roundLimit " + instance.vars.ROUND_LIMIT
  + " / grandTotal " + instance.vars.GRAND_TOTAL
  + (grandTotal === 0 ? " (무제한)" : " (cap)")
  + " / pollWait " + instance.vars.POLL_WAIT_SEC + "s"
  + " / 스로틀 ~" + throttleMs + "ms"
  + " / custom=" + customAttr
  + " / table " + memTable
  + " / schema " + schema);
