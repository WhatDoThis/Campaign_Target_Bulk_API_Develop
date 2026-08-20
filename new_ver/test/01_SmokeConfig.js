/* ============================================================================
 * TBAWSmoke / 01_Config (스모크 설정·정합성)
 * 설정은 BULK_CFG + 이 파일 상단 스위치만. xtk:option 으로 설정을 읽지 않음.
 * 02는 dryRun. 03→07은 샘플 UID SMOKE_REAL_ROWS건 실전송(샌드박스).
 *
 * [Main Functions]
 * 1. loadLibrary 후 BULK_CFG / BulkApiWorker 존재 확인
 * 2. 스위치·스모크 상수를 instance.vars 로 전파
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js, formatDate, setOption(상태 초기화만)
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

/* --- [S1] 테스트 스위치 ------------------------------------------------- */
var T_SCHEMA_IO = true;    // Master/Detail 쓰기·링크·삭제
var T_PARTITION = true;    // 워커 UID 분할 산술 검증
var T_CURSOR    = true;    // sqlExec apiYn 왕복 (3건, 원복)
var T_LIB_DRY   = true;    // 같은 캔버스에서 라이브러리 dryRun (미전송)
var T_SIGNAL    = true;    // PostEvent → TBAWSmokeSignal. 기본 실전송(소수)
var T_API_CHECK = true;    // 05: 실전송 Master batchStatus + Profile Fetch
var T_API_NEG   = false;   // batch= 누락 실패 경로 (가짜 프로필 아님)
var DO_CLEANUP  = true;    // 종료 시 이번 runId / SMOKE 로그 삭제. Target·apiYn은 남김

/* --- [S2] 스모크 전용 상수. 운영 Factory 값이 아님 -------------------- */
var SIGNAL_WF       = "TBAWSmokeSignal";
var SIG_ACTIVITY    = "sigWorker";
var SMOKE_WORKERS   = 5;
var SMOKE_BATCH     = 100;   // 02 dryRun 조회 폭
var SMOKE_LIMIT     = 300;
var SMOKE_REAL_ROWS = 2;     // 03→07 실전송 행수. 샌드박스 소수만
var MAX_POLL        = 20;

var PASS = 0, FAIL = 0, FAILS = [];
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS.push(n); logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}

var runId = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S");
logInfo("########## SMOKE START runId=" + runId + " ##########");
logInfo("=== T1 Config (BULK_CFG) ===");

ok("BULK_CFG 로드", typeof BULK_CFG === "object" && BULK_CFG !== null, "");
ok("BulkApiWorker 정의", typeof BulkApiWorker === "function", "");

var MEMBER_SCHEMA = (typeof BULK_CFG !== "undefined") ? String(BULK_CFG.MEMBER_SCHEMA || "") : "";
var CLIENT_CODE   = (typeof BULK_CFG !== "undefined") ? String(BULK_CFG.CLIENT_CODE || "") : "";
var BATCH_SIZE    = (typeof BULK_CFG !== "undefined") ? parseInt(BULK_CFG.BATCH_SIZE, 10) : 0;

ok("MemberSchema 형식", MEMBER_SCHEMA.indexOf(":") > 0, MEMBER_SCHEMA);
ok("ClientCode 존재", CLIENT_CODE.length > 0, CLIENT_CODE);
ok("BATCH_SIZE 1~500000", BATCH_SIZE > 0 && BATCH_SIZE <= 500000, "=" + BATCH_SIZE);
ok("AUTH_TOKEN 비어 있음 또는 설정됨", true,
  (typeof BULK_CFG !== "undefined" && BULK_CFG.AUTH_TOKEN) ? "Profile API 토큰 on" : "헤더 생략(Require Authentication OFF)");

instance.vars.smkRunId     = runId;
instance.vars.smkTag       = "SMOKE-" + runId;
instance.vars.smkSigWf     = SIGNAL_WF;
instance.vars.smkSigAct    = SIG_ACTIVITY;
instance.vars.smkSchema    = MEMBER_SCHEMA;
instance.vars.smkElement   = (MEMBER_SCHEMA.indexOf(":") > 0) ? MEMBER_SCHEMA.split(":")[1] : "";
instance.vars.smkClient    = CLIENT_CODE;
instance.vars.smkUrl       = "https://" + CLIENT_CODE + ".tt.omtrdc.net/m2/"
                           + CLIENT_CODE + "/v2/profile/batchUpdate";
instance.vars.smkPending   = "(@apiYn = 'N' OR @apiYn IS NULL)";
instance.vars.smkUidPrefix = "U";
instance.vars.smkUidDigits = 9;
instance.vars.smkBatch     = SMOKE_BATCH;
instance.vars.smkLimit     = SMOKE_LIMIT;
instance.vars.smkRealRows  = SMOKE_REAL_ROWS;
instance.vars.smkWorkers   = SMOKE_WORKERS;
instance.vars.smkMaxPoll   = MAX_POLL;
instance.vars.smkPollCnt   = 0;
instance.vars.smkOptKey    = "WORKER_DONE_SMOKE";
instance.vars.smkCustom    = (typeof BULK_CFG !== "undefined") ? String(BULK_CFG.CUSTOM_ATTR || "") : "";

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
logInfo("  customAttr = " + (instance.vars.smkCustom || "(none)"));
logInfo("  실전송 행수 = " + SMOKE_REAL_ROWS + " (03 Fire → 07, dryRun=false)");
