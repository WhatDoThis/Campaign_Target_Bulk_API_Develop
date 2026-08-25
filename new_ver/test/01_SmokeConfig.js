/* ============================================================================
 * TBAWSmoke / 01_Config (스모크 설정·정합성)
 * 연동 값: SMOKE_CFG(배분·레이트·속성) + BULK_CFG(스키마·토큰·Target 규격).
 * xtk:option 으로 설정을 읽지 않음.
 * 02는 dryRun. 03→07은 pending 큐 키 SMOKE_REAL_ROWS건 실전송(샌드박스).
 *
 * [Main Functions]
 * 1. loadLibrary 후 BULK_CFG / BulkApiWorker 존재 확인
 * 2. SMOKE_CFG·BIZ_DATE·pending·스모크 스위치를 instance.vars 로 전파
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js, formatDate, setOption(상태 초기화만)
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

/* --- [S1] 테스트 스위치 ------------------------------------------------- */
var T_SCHEMA_IO = true;    // Master/Sample 쓰기·링크·삭제
var T_PARTITION = true;    // 워커 큐 키(ingestYmd+lineNo) offset 분할 검증
var T_CURSOR    = true;    // sqlExec apiYn 왕복 (3건, 원복)
var T_LIB_DRY   = true;    // 같은 캔버스에서 라이브러리 dryRun (미전송)
var T_SIGNAL    = true;    // PostEvent → TBAWSmokeSignal. 기본 실전송(소수)
var T_API_CHECK = true;    // 05: 실전송 Master batchStatus + Profile Fetch
var T_API_NEG   = false;   // batch= 누락 실패 경로 (가짜 프로필 아님)
var DO_CLEANUP  = true;    // 종료 시 이번 runId / SMOKE 로그 삭제. Target·apiYn은 남김

/* --- [S2] 스모크 전용 배분·레이트·속성 ----------------------------------- */
var SIGNAL_WF       = "TBAWSmokeSignal";
var SIG_ACTIVITY    = "sigWorker";
var SMOKE_LIMIT     = 300;   // T4 분할·T6b 구간 폭. 운영 배치 크기 아님
var SMOKE_REAL_ROWS = 2;     // 03→07 실전송 행수. 샌드박스 소수만

var SMOKE_WORKER_COUNT  = 3;
var SMOKE_WORKER_MAX    = 15;
var SMOKE_BATCH_SIZE    = 80000;
var SMOKE_CUSTOM_ATTR   = "@planName";
var SMOKE_ACCOUNT_CPM   = 50;
var SMOKE_STATUS_CPM    = 5;
var SMOKE_SAFETY_RATIO  = 0.9;
var SMOKE_STAGGER_SLOT_MS = 1200;

/* --- [S3] 적재 기준일 BIZ_DATE (Factory 00_Config 와 동일 규칙) ---------------
 * 포맷: YYYYMMDD 8자리 (예: 20260824). 하이픈·YYYYMM(6자) 금지.
 * ""  → 실행 시점 오늘 (formatDate %4Y%2M%2D)
 * "20260824" → hardcode — 비오늘 데이터 재전송·누락분(apiYn=N) 테스트
 * ------------------------------------------------------------------------- */
var SMOKE_BIZ_DATE  = "";

var PASS = 0, FAIL = 0, FAILS = [];
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS.push(n); logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}

var runId = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S");
logInfo("########## SMOKE START runId=" + runId + " ##########");
logInfo("=== T1 Config (SMOKE_CFG + BULK_CFG) ===");

ok("BULK_CFG 로드", typeof BULK_CFG === "object" && BULK_CFG !== null, "");
ok("BulkApiWorker 정의", typeof BulkApiWorker === "function", "");

var bizDate = BulkApiWorker.resolveBizDate(SMOKE_BIZ_DATE);
ok("BIZ_DATE YYYYMMDD", /^[0-9]{8}$/.test(bizDate), bizDate);

var MEMBER_SCHEMA = (typeof BULK_CFG !== "undefined") ? String(BULK_CFG.MEMBER_SCHEMA || "") : "";
var CLIENT_CODE   = (typeof BULK_CFG !== "undefined") ? String(BULK_CFG.CLIENT_CODE || "") : "";
var LINE_MAX      = (typeof BULK_CFG !== "undefined") ? parseInt(BULK_CFG.LINE_NO_MAX, 10) : 0;

ok("MemberSchema 형식", MEMBER_SCHEMA.indexOf(":") > 0, MEMBER_SCHEMA);
ok("ClientCode 존재", CLIENT_CODE.length > 0, CLIENT_CODE);
ok("SMOKE_BATCH_SIZE 1~100000", SMOKE_BATCH_SIZE > 0 && SMOKE_BATCH_SIZE <= 100000,
  "=" + SMOKE_BATCH_SIZE);
ok("LINE_NO_MAX 1~2147483647", LINE_MAX >= 1 && LINE_MAX <= 2147483647,
  isNaN(LINE_MAX) ? "라이브러리에 LINE_NO_MAX 없음 — testWooBulkApiWorker.js 재게시" : "=" + LINE_MAX);
ok("SMOKE_WORKER_COUNT 1~SMOKE_WORKER_MAX",
  SMOKE_WORKER_COUNT >= 1 && SMOKE_WORKER_COUNT <= SMOKE_WORKER_MAX,
  "=" + SMOKE_WORKER_COUNT + "/" + SMOKE_WORKER_MAX);
ok("AUTH_TOKEN 비어 있음 또는 설정됨", true,
  (typeof BULK_CFG !== "undefined" && BULK_CFG.AUTH_TOKEN) ? "Profile API 토큰 on" : "헤더 생략(Require Authentication OFF)");

var smkPending = "@apiYn = 'N' AND @lineNo >= 1 AND @ingestYmd = '" + bizDate + "'";

instance.vars.smkRunId     = runId;
instance.vars.smkTag       = "SMOKE-" + runId;
instance.vars.smkSigWf     = SIGNAL_WF;
instance.vars.smkSigAct    = SIG_ACTIVITY;
instance.vars.smkSchema    = MEMBER_SCHEMA;
instance.vars.smkElement   = (MEMBER_SCHEMA.indexOf(":") > 0) ? MEMBER_SCHEMA.split(":")[1] : "";
instance.vars.smkClient    = CLIENT_CODE;
instance.vars.smkUrl       = "https://" + CLIENT_CODE + ".tt.omtrdc.net/m2/"
                           + CLIENT_CODE + "/v2/profile/batchUpdate";
instance.vars.smkBizDate   = bizDate;
instance.vars.smkPending   = smkPending;
instance.vars.smkLimit     = SMOKE_LIMIT;
instance.vars.smkRealRows  = SMOKE_REAL_ROWS;
instance.vars.smkMaxPoll   = 20;
instance.vars.smkPollCnt   = 0;
instance.vars.smkOptKey    = "WORKER_DONE_SMOKE";

instance.vars.smkBatchSize      = SMOKE_BATCH_SIZE;
instance.vars.smkWorkerCount    = SMOKE_WORKER_COUNT;
instance.vars.smkWorkerMax      = SMOKE_WORKER_MAX;
instance.vars.smkCustomAttr     = SMOKE_CUSTOM_ATTR;
instance.vars.smkAccountCpm     = SMOKE_ACCOUNT_CPM;
instance.vars.smkStatusCpm      = SMOKE_STATUS_CPM;
instance.vars.smkSafetyRatio    = SMOKE_SAFETY_RATIO;
instance.vars.smkStaggerSlotMs  = SMOKE_STAGGER_SLOT_MS;

instance.vars.smkTSchemaIo = T_SCHEMA_IO ? "1" : "0";
instance.vars.smkTPart     = T_PARTITION ? "1" : "0";
instance.vars.smkTCursor   = T_CURSOR    ? "1" : "0";
instance.vars.smkTLibDry   = T_LIB_DRY   ? "1" : "0";
instance.vars.smkTSignal   = T_SIGNAL    ? "1" : "0";
instance.vars.smkTApi      = T_API_CHECK ? "1" : "0";
instance.vars.smkTNeg      = T_API_NEG   ? "1" : "0";
instance.vars.smkCleanup   = DO_CLEANUP  ? "1" : "0";

instance.vars.smkPass  = PASS;
instance.vars.smkFail  = FAIL;
instance.vars.smkFails = FAILS.join(", ");

try { setOption(instance.vars.smkOptKey, "", "smoke worker status"); } catch (e) {}
logInfo("  URL = " + instance.vars.smkUrl);
logInfo("  BATCH_SIZE=" + SMOKE_BATCH_SIZE + " WORKER_COUNT=" + SMOKE_WORKER_COUNT
  + " customAttr=" + (SMOKE_CUSTOM_ATTR || "(none)"));
logInfo("  BIZ_DATE=" + bizDate + " (SMOKE_BIZ_DATE=" + (SMOKE_BIZ_DATE || "(auto)") + ")");
logInfo("  pending = apiYn=N AND lineNo>=1 AND ingestYmd=" + bizDate);
logInfo("  실전송 행수 = " + SMOKE_REAL_ROWS + " (03 Fire → 07, dryRun=false)");
