/* ============================================================================
 * TBAWSmoke / 04_Poll — 워커 브랜치 상태를 옵션으로 확인
 *   nextStep: working(재폴링) | done(다음 단계) 
 * ==========================================================================*/

var PASS  = parseInt(instance.vars.smkPass, 10) || 0;
var FAIL  = parseInt(instance.vars.smkFail, 10) || 0;
var FAILS = String(instance.vars.smkFails || "");

var cnt = (parseInt(instance.vars.smkPollCnt, 10) || 0) + 1;
var max = parseInt(instance.vars.smkMaxPoll, 10) || 20;
instance.vars.smkPollCnt = cnt;

var st = "";
try { st = String(getOption(String(instance.vars.smkOptKey), false) || ""); } catch (e) { st = ""; }
logInfo("[Poll " + cnt + "/" + max + "] status=" + (st || "(빈값)"));

if (st === "done") {
  PASS++; logInfo("  [PASS] 시그널→워커 왕복 완료");
  instance.vars.smkNext = "done";
} else if (st === "skip") {
  logInfo("  [SKIP] 워커 브랜치 비활성");
  instance.vars.smkNext = "done";
} else if (st === "error") {
  FAIL++; FAILS += (FAILS ? ", " : "") + "워커 실행 실패";
  logWarning("  [FAIL] 워커가 error 보고 — 워커 브랜치 로그 확인");
  instance.vars.smkNext = "done";
} else if (cnt >= max) {
  FAIL++; FAILS += (FAILS ? ", " : "") + "워커 응답 타임아웃";
  logWarning("  [FAIL] " + max + "회 폴링 초과 (마지막 status=" + st + ")");
  instance.vars.smkNext = "done";
} else {
  instance.vars.smkNext = "working";
}

instance.vars.smkPass  = PASS;
instance.vars.smkFail  = FAIL;
instance.vars.smkFails = FAILS;
