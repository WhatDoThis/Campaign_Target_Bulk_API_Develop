/* ============================================================================
 * TBAWSmoke / 01_Config
 * 스위치·옵션 로드 + 설정 정합성 검사. 결과는 instance.vars 에 누적한다.
 * ==========================================================================*/

/* --- [S1] 테스트 스위치 ------------------------------------------------- */
var T_SCHEMA_IO  = true;    // Master/Detail 쓰기·링크·삭제
var T_PARTITION  = true;    // 워커 UID 분할 산술 검증
var T_CURSOR     = true;    // sqlExec apiYn 왕복 (3건, 원복)
var T_SIGNAL     = true;    // 시그널 → 워커 드라이런 (동일 캔버스)
var T_API_REAL   = true;    // 실제 Bulk API 호출 (가짜 프로필 2건 생성됨)
var T_API_NEG    = true;    // 잘못된 payload로 에러 파싱 경로 검증
var DO_CLEANUP   = true;    // 종료 시 DB 흔적 삭제

/* --- [S2] 스모크 전용 상수 ---------------------------------------------- */
var SIGNAL_WF      = "TBAWSmokeSignal";   // 시그널 수신 워크플로우 내부명 (별도 WF)
var SIG_ACTIVITY   = "sigWorker";   // 시그널 활동 내부명
var SMOKE_WORKERS  = 5;             // 분할 검증용 가상 워커 수
var SMOKE_BATCH    = 100;           // 드라이런 배치 크기
var SMOKE_LIMIT    = 300;           // 드라이런에서 훑을 UID 폭
var MAX_POLL       = 20;            // 30초 × 20 = 최대 10분 대기

/* --- [S3] 옵션 로더 ------------------------------------------------------ */
var OPT_PREFIX = "testWooTarBulk";
function opt(k, d) {
  var v; try { v = getOption(OPT_PREFIX + k, false); } catch (e) { v = undefined; }
  if (v === undefined || v === null) return String(d);
  v = String(v).replace(/^\s+|\s+$/g, "");
  return (v === "") ? String(d) : v;
}
function optNum(k, d) { var n = parseInt(opt(k, d), 10); return (isNaN(n) || n <= 0) ? d : n; }

/* --- [S4] 결과 누적기 ---------------------------------------------------- */
var PASS = 0, FAIL = 0, FAILS = [];
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS.push(n); logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}

var runId = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S");
logInfo("########## SMOKE START runId=" + runId + " ##########");
logInfo("=== T1 Config ===");

/* --- [S5] 설정 검증 ------------------------------------------------------ */
var MEMBER_SCHEMA = opt("MemberSchema", "");
var CLIENT_CODE   = opt("ClientCode", "");

ok("MemberSchema 형식", MEMBER_SCHEMA.indexOf(":") > 0, MEMBER_SCHEMA);
ok("ClientCode 존재", CLIENT_CODE.length > 0, CLIENT_CODE);
ok("WorkerCount 양수", optNum("WorkerCount", 0) > 0, "=" + optNum("WorkerCount", 0));
ok("BatchSize 500k 이하", optNum("BatchSize", 5000) <= 500000, "=" + optNum("BatchSize", 5000));

/* --- [S6] 인스턴스 변수 전파 --------------------------------------------- */
instance.vars.smkRunId     = runId;
instance.vars.smkTag       = "SMOKE-" + runId;
instance.vars.smkSigWf     = SIGNAL_WF;
instance.vars.smkSigAct    = SIG_ACTIVITY;
instance.vars.smkSchema    = MEMBER_SCHEMA;
instance.vars.smkElement   = (MEMBER_SCHEMA.indexOf(":") > 0) ? MEMBER_SCHEMA.split(":")[1] : "";
instance.vars.smkClient    = CLIENT_CODE;
instance.vars.smkUrl       = "https://" + CLIENT_CODE + ".tt.omtrdc.net/m2/"
                           + CLIENT_CODE + "/v2/profile/batchUpdate";
instance.vars.smkPending   = opt("PendingCond", "@apiYn = 'N'");
instance.vars.smkUidPrefix = opt("UidPrefix", "U");
instance.vars.smkUidDigits = optNum("UidDigits", 9);
instance.vars.smkBatch     = SMOKE_BATCH;
instance.vars.smkLimit     = SMOKE_LIMIT;
instance.vars.smkWorkers   = SMOKE_WORKERS;
instance.vars.smkMaxPoll   = MAX_POLL;
instance.vars.smkPollCnt   = 0;
instance.vars.smkOptKey    = "WORKER_DONE_SMOKE";

instance.vars.smkTSchemaIo = T_SCHEMA_IO ? "1" : "0";
instance.vars.smkTPart     = T_PARTITION ? "1" : "0";
instance.vars.smkTCursor   = T_CURSOR    ? "1" : "0";
instance.vars.smkTSignal   = T_SIGNAL    ? "1" : "0";
instance.vars.smkTApi      = T_API_REAL  ? "1" : "0";
instance.vars.smkTNeg      = T_API_NEG   ? "1" : "0";
instance.vars.smkCleanup   = DO_CLEANUP  ? "1" : "0";

instance.vars.smkPass  = PASS;
instance.vars.smkFail  = FAIL;
instance.vars.smkFails = FAILS.join(", ");

// 이전 회차 잔여 상태 제거
setOption(instance.vars.smkOptKey, "", "smoke worker status");
logInfo("  URL = " + instance.vars.smkUrl);
