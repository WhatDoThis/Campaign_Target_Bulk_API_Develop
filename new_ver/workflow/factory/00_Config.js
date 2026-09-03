/* ============================================================================
 * TBAWFactory / 00_Config (Factory 설정)
 * ============================================================================
 * 연동 값: FACTORY_CFG(배분·레이트·라운드) + BULK_CFG(스키마·Target 규격).
 *
 * 캔버스:
 *   Start → 00_Config → 00a_Test (TokenGate)
 *     Test proceed → 01_WorkerDistributor → 02_Polling → 03_Test
 *       Test working → Wait 15s → 02
 *       Test next    → 01
 *       Test finish  → End (03_End.js)
 *     Test block     → End (토큰 만료 — Distributor 생략)
 *
 * [00a_Test TokenGate — JavaScript 조건 2개]
 *   proceed: String(instance.vars.tokenGate) != 'block'  → 01_WorkerDistributor
 *   block:   String(instance.vars.tokenGate) == 'block'  → End
 *
 * [Main Functions]
 * 1. FACTORY_CFG — WORKER/BATCH/CUSTOM_ATTR·GRAND_TOTAL·BIZ_DATE·폴링
 * 2. BULK_CFG 정합·MEMBER_TABLE·pending 시작 건수(선택)
 * 3. 토큰 만료일 계산·알림 PostEvent·tokenGate(block|proceed)
 * 4. instance.vars 전파·sessionRunId
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

var FACTORY_CFG = {

  /* ---- 라운드 스코프 ---- */
  // 라운드당 line 구간 상한. ""/0 → fallback(아래 Config)
  ROUND_LIMIT   : 500000,
  
  // 0 = 무제한 — BIZ_DATE pending 전량까지 라운드 반복.
  GRAND_TOTAL   : 1000000,
  
  // 적재 기준일 YYYYMMDD. 빈값("")이면 오늘. 수기입력(ex. "20260824") 가능
  BIZ_DATE      : "20260824",
  
  /* ---- 워커 배분 ---- */
  WORKER_COUNT  : 5,
  WORKER_MAX    : 15,
  BATCH_SIZE    : 50000,

  /* ---- 전송 속성 ---- */
  CUSTOM_ATTR   : "@planName, @optimalSendTime, @mConsent",

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
  POLL_WAIT_SEC : 15,

  // true: 시작 시 pending 건수 queryDef count (대량 테이블에서 Config 지연·취소 가능)
  PENDING_START_COUNT : false,

  // true: lineNo 밀집 큐 — COUNT/대 offset 없이 head+산술 cap 분할 (5천만 건급 운영)
  DENSE_LINE_SPLIT    : true
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
var todayYmd = BulkApiWorker.resolveBizDate(""); // 토큰 만료·알림은 실제 오늘 기준(BIZ_DATE 적재일과 분리)
if (!/^[0-9]{8}$/.test(bizDate)) {
  throw new Error("[Config] BIZ_DATE 형식 오류(YYYYMMDD 8자리): " + bizDate);
}

var grandTotal = parseInt(FACTORY_CFG.GRAND_TOTAL, 10);
if (isNaN(grandTotal) || grandTotal < 0) grandTotal = 0;

var roundLimit = parseInt(FACTORY_CFG.ROUND_LIMIT, 10);
if (!(roundLimit >= 1)) {
  roundLimit = (grandTotal > 0) ? grandTotal : 10000000;
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
if (FACTORY_CFG.PENDING_START_COUNT === true) {
  try {
    var cntQ = xtk.queryDef.create(
      <queryDef schema={schema} operation="count">
        <where>
          <condition expr={pendingXPath}/>
        </where>
      </queryDef>
    ).ExecuteQuery();
    pendingStartCnt = parseInt(cntQ.@count, 10) || 0;
  } catch (eCnt) {
    logWarning("[Config] pending count 실패(진행 계속): "
      + (eCnt.message || String(eCnt)));
  }
}

var sessionRunId = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S");

instance.vars.tokenGate         = "proceed";
instance.vars.tokenDaysLeft     = -1;
instance.vars.tokenExpireYmd    = "";
instance.vars.tokenNotifyPhase  = "";

var tokenEval = BulkApiWorker.evalTokenExpiry({ todayYmd: todayYmd });
if (!tokenEval.enabled) {
  var hasToken = String(BULK_CFG.AUTH_TOKEN || "").replace(/^\s+|\s+$/g, "") !== "";
  if (hasToken) {
    logWarning("[Config] AUTH_TOKEN 설정됨 — AUTH_TOKEN_CREATED_YMD 미입력, 만료 가드 생략");
  }
} else if (tokenEval.error) {
  logWarning("[Config] 토큰 만료일 계산 실패 — 가드 생략");
} else {
  instance.vars.tokenDaysLeft    = tokenEval.daysLeft;
  instance.vars.tokenExpireYmd   = tokenEval.expireYmd;
  instance.vars.tokenCreatedYmd  = tokenEval.createdYmd;

  if (tokenEval.notify) {
    instance.vars.tokenNotifyPhase = tokenEval.notifyPhase;
    var notifyOptKey = String(BULK_CFG.TOKEN_NOTIFY_OPT_KEY || "BULK_TOKEN_LAST_NOTIFY_YMD");
    var lastNotifyYmd = "";
    try { lastNotifyYmd = String(getOption(notifyOptKey, false) || ""); } catch (eOpt) { lastNotifyYmd = ""; }
    if (lastNotifyYmd === todayYmd) {
      logInfo("[Config] Token 알림 생략 — 오늘(" + todayYmd + ") 이미 발송");
    } else if (BulkApiWorker.postTokenExpireNotify(tokenEval, {
      asOfYmd: todayYmd, sessionRunId: sessionRunId
    })) {
      try { setOption(notifyOptKey, todayYmd, "bulk token expiry last notify ymd"); } catch (eSet) {
        logWarning("[Config] Token 알림 Option 저장 실패: " + (eSet.message || eSet));
      }
    }
  }

  if (tokenEval.block) {
    instance.vars.tokenGate    = "block";
    instance.vars.nextAction   = "finish";
    instance.vars.finishReason = "token_expired";
    logWarning("[Config] AUTH_TOKEN 만료 — 전송 중단 daysLeft=" + tokenEval.daysLeft
      + " / expire=" + tokenEval.expireYmd
      + " / created=" + tokenEval.createdYmd);
  } else {
    logInfo("[Config] Token expire=" + tokenEval.expireYmd
      + " / 잔여 " + tokenEval.daysLeft + "일"
      + (tokenEval.notify ? " / 알림=" + tokenEval.notifyPhase : ""));
  }
}

instance.vars.MEMBER_SCHEMA   = schema;
instance.vars.MEMBER_ELEMENT  = String(BULK_CFG.MEMBER_ELEMENT || schema.split(":")[1]);
instance.vars.MEMBER_TABLE    = memTable;
instance.vars.BIZ_DATE        = bizDate;
instance.vars.sessionRunId    = sessionRunId;
instance.vars.pendingStartCnt = pendingStartCnt;
instance.vars.PENDING_COND     = pendingXPath;
instance.vars.PENDING_COND_SQL = pendingSql;
instance.vars.DENSE_LINE_SPLIT = (FACTORY_CFG.DENSE_LINE_SPLIT !== false) ? "true" : "false";
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
var tokenBlocked = (String(instance.vars.tokenGate) === "block");
instance.vars.nextAction      = tokenBlocked ? "finish" : "";
instance.vars.finishReason    = tokenBlocked ? "token_expired" : "";
instance.vars.prevProcessed   = -1;
instance.vars.stallCount      = 0;

logInfo("[Config] sessionRunId=" + sessionRunId
  + " / BIZ_DATE=" + bizDate
  + (bizDateOverride ? " (hardcode)" : " (auto)")
  + " / pendingStart=" + (pendingStartCnt >= 0 ? pendingStartCnt
    : (FACTORY_CFG.PENDING_START_COUNT === true ? "(조회실패)" : "(생략)"))
  + " / 워커 " + wCount + "/" + wMax
  + " / batch " + batch
  + " / roundLimit " + instance.vars.ROUND_LIMIT
  + " / grandTotal " + instance.vars.GRAND_TOTAL
  + (grandTotal === 0 ? " (무제한·pending 소진까지)" : " (sent cap)")
  + " / pollWait " + instance.vars.POLL_WAIT_SEC + "s"
  + " / 스로틀 ~" + throttleMs + "ms"
  + " / custom=" + customAttr
  + " / table " + memTable
  + " / schema " + schema
  + " / tokenGate=" + String(instance.vars.tokenGate || "proceed")
  + (instance.vars.tokenExpireYmd
    ? " / tokenExpire=" + instance.vars.tokenExpireYmd
      + " left=" + instance.vars.tokenDaysLeft + "d"
      + " (asOf=" + todayYmd + ")"
    : ""));
