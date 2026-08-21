/* ============================================================================
 * TBAWFactory / 00_Config (Factory 설정)
 * ============================================================================
 * 연동 값(스키마·배치·토큰·워커 수·상한)은 BULK_CFG. 여기서 다시 선언·오버라이드하지 않음.
 * 이 파일은 라운드 물량·폴링·WF 이름만. xtk:option 은 상태 핸드셰이크만.
 *
 * 캔버스:
 *   Start → 00 → 01_Distributor → 02_Polling → 03_Test
 *     Test working → 1m Wait → 02
 *     Test next    → 01
 *     Test finish  → End
 *   03_Test 조건: instance.vars.nextAction == 'working' | 'next' | 'finish'
 *
 * 워커 WF: TBAW1 .. TBAWn. 항상 시작됨(state=11). 활동명 sigWorker.
 *   코드는 workflow/worker/worker.js. PostEvent complete=false.
 *
 * [Main Functions]
 * 1. FACTORY_CFG — 라운드 물량·폴링·WF 이름
 * 2. BULK_CFG 정합 — 워커 수·배치·스키마 미리보기 (복사 선언 없음)
 * 3. instance.vars 전파 — 01/02 가 읽는 문자열 계약
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

// # 1. [Config] 운영자가 만지는 값만 이 객체. 01/02 는 instance.vars 만 본다.
var FACTORY_CFG = {

  /* --- [F1] 물량 상한. pending 큐 키(ingestYm+lineNo) 오름차순 -------- */
  // ROUND_LIMIT: 한 라운드에서 워커에 나눠 줄 pending 행 수 (그달 정렬 목록의 앞 N건).
  //   GRAND_TOTAL 과 같게 두면 한 라운드에 목표 건수를 다 넣는다.
  //   가드레일: 1 미만이면 5000000. GrandTotal 잔여보다 크면 잔여로 잘림
  ROUND_LIMIT   : 500000,

  // GRAND_TOTAL: 이 Factory 실행의 누적 성공 sent 상한. 02 가 워커 보고 sent 합으로 판정.
  //   0 = 무제한 (pending 이 없을 때까지 라운드 반복)
  //   시작점은 apiYn N 이고 lineNo>=1 인 가장 앞 큐 행
  GRAND_TOTAL   : 5000000,

  /* --- [F2] 분할. 같은 ingestYm 안 lineNo offset. UID 구간 없음 ------- */
  // EXACT_COUNT: true 면 그달 pending count 로 remaining 을 자른다. 5천만 count 는 비쌈
  EXACT_COUNT   : false,

  /* --- [F3] 워커 WF 이름. {n} = 1..BULK_CFG.WORKER_COUNT ------------ */
  WORKER_WF     : "TBAW{n}",
  WORKER_NAME   : "TBAW{n}",
  WORKER_SIG    : "sigWorker",

  /* --- [F4] 상태 Option / 폴링 -------------------------------------- */
  OPT_PREFIX    : "WORKER_DONE_",
  STRICT_RUNID  : true,
  ABORT_ON_ERR  : false,
  MAX_READY     : 5,
  MAX_RUN       : 360,
  STAGGER_POST  : 300
};

// # 2. [Validate]
if (typeof BULK_CFG === "undefined" || typeof BulkApiWorker !== "function") {
  throw new Error("[Config] wootar:testWooBulkApiWorker.js 로드 실패 — JS 내부명 확인");
}

var lineMax = parseInt(BULK_CFG.LINE_NO_MAX, 10);
if (!(lineMax >= 1)) {
  throw new Error("[Config] BULK_CFG.LINE_NO_MAX 없음 — 라이브러리 재게시");
}

var wCount = parseInt(BULK_CFG.WORKER_COUNT, 10) || 5;
var wMax   = parseInt(BULK_CFG.WORKER_MAX, 10) || 15;
if (wCount < 1) wCount = 1;
if (wCount > wMax) {
  logWarning("[Config] WORKER_COUNT " + wCount + " > WORKER_MAX " + wMax
    + " → " + wMax + "으로 제한");
  wCount = wMax;
}

var schema = String(BULK_CFG.MEMBER_SCHEMA || "");
if (schema.indexOf(":") < 0) {
  throw new Error("[Config] MEMBER_SCHEMA 형식 오류: '" + schema + "'");
}

var batch = parseInt(BULK_CFG.BATCH_SIZE, 10) || 5000;
if (batch < 1) batch = 1;
if (batch > parseInt(BULK_CFG.LIMIT_ROWS, 10)) {
  throw new Error("[Config] BATCH_SIZE " + batch + " > Target 상한");
}

var cpm = (BULK_CFG.ACCOUNT_CPM * BULK_CFG.SAFETY_RATIO) / wCount;
var throttleMs = Math.ceil(60000 / (cpm > 0 ? cpm : 1));

var roundLimit = parseInt(FACTORY_CFG.ROUND_LIMIT, 10);
if (!(roundLimit >= 1)) roundLimit = 5000000;

// # 3. [Vars]
instance.vars.MEMBER_SCHEMA  = schema;
instance.vars.MEMBER_ELEMENT = String(BULK_CFG.MEMBER_ELEMENT || schema.split(":")[1]);
instance.vars.PENDING_COND   = "(@apiYn = 'N' OR @apiYn IS NULL) AND @lineNo >= 1 AND @ingestYm != ''";
instance.vars.WORKER_COUNT   = wCount;
instance.vars.ROUND_LIMIT    = roundLimit;
instance.vars.GRAND_TOTAL    = parseInt(FACTORY_CFG.GRAND_TOTAL, 10) || 0;
instance.vars.EXACT_COUNT    = FACTORY_CFG.EXACT_COUNT ? "true" : "false";
instance.vars.WORKER_WF_TPL  = String(FACTORY_CFG.WORKER_WF);
instance.vars.WORKER_NAME_TPL= String(FACTORY_CFG.WORKER_NAME);
instance.vars.WORKER_SIG     = String(FACTORY_CFG.WORKER_SIG || "sigWorker");
instance.vars.OPT_PREFIX     = String(FACTORY_CFG.OPT_PREFIX || "WORKER_DONE_");
instance.vars.STRICT_RUNID   = FACTORY_CFG.STRICT_RUNID ? "true" : "false";
instance.vars.ABORT_ON_WORKER_ERROR = FACTORY_CFG.ABORT_ON_ERR ? "true" : "false";
instance.vars.MAX_READY_POLL = parseInt(FACTORY_CFG.MAX_READY, 10) || 5;
instance.vars.MAX_RUN_POLL   = parseInt(FACTORY_CFG.MAX_RUN, 10) || 360;
instance.vars.STAGGER_POST_MS= parseInt(FACTORY_CFG.STAGGER_POST, 10) || 0;
instance.vars.round          = 0;
instance.vars.globalProcessed= 0;
instance.vars.pollCount      = 0;
instance.vars.nextAction     = "";

logInfo("[Config] 워커 " + wCount + "/" + wMax
  + " / batch " + batch
  + " / roundLimit " + instance.vars.ROUND_LIMIT
  + " / grandTotal " + instance.vars.GRAND_TOTAL
  + " / 스로틀 ~" + throttleMs + "ms"
  + " / custom=" + (BULK_CFG.CUSTOM_ATTR || "(none)")
  + " / schema " + schema);
