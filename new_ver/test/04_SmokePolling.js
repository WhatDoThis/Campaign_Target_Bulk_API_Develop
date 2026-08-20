/* ============================================================================
 * TBAWSmoke / 04_Poll (워커 상태 폴링)
 * Option 값: {runId}|status. Factory 02_Polling STRICT 와 같은 계약.
 * nextStep: working | done
 *
 * [Dependencies]
 * getOption(상태 핸드셰이크만)
 * ==========================================================================*/

var PASS  = parseInt(instance.vars.smkPass, 10) || 0;
var FAIL  = parseInt(instance.vars.smkFail, 10) || 0;
var FAILS = String(instance.vars.smkFails || "");

var cnt = (parseInt(instance.vars.smkPollCnt, 10) || 0) + 1;
var max = parseInt(instance.vars.smkMaxPoll, 10) || 20;
instance.vars.smkPollCnt = cnt;

var raw = "";
try { raw = String(getOption(String(instance.vars.smkOptKey), false) || ""); } catch (e) { raw = ""; }

var expect = String(instance.vars.smkRunId || "");
var rid = "";
var st  = raw;
var pipe = raw.indexOf("|");
if (pipe > 0) {
  rid = raw.substring(0, pipe);
  st  = raw.substring(pipe + 1);
}

logInfo("[Poll " + cnt + "/" + max + "] raw=" + (raw || "(빈값)")
  + " / runId=" + (rid || "-") + " / status=" + (st || "-"));

function setNext(v) {
  instance.vars.smkNext = v;
  instance.vars.nextAction = v;
}

if (rid && expect && rid !== expect) {
  logInfo("  stale runId (기대 " + expect + ") — 대기");
  setNext((cnt >= max) ? "done" : "working");
  if (cnt >= max) {
    FAIL++; FAILS += (FAILS ? ", " : "") + "워커 응답 타임아웃(stale)";
    logWarning("  [FAIL] stale runId 로 " + max + "회 초과");
  }
} else if (st === "done") {
  PASS++; logInfo("  [PASS] 시그널→워커 왕복 완료");
  setNext("done");
} else if (st === "skip") {
  logInfo("  [SKIP] 워커 브랜치 비활성");
  setNext("done");
} else if (st === "error") {
  FAIL++; FAILS += (FAILS ? ", " : "") + "워커 실행 실패";
  logWarning("  [FAIL] 워커가 error 보고 — TBAWSmokeSignal 로그 확인");
  setNext("done");
} else if (cnt >= max) {
  FAIL++; FAILS += (FAILS ? ", " : "") + "워커 응답 타임아웃";
  logWarning("  [FAIL] " + max + "회 폴링 초과 (마지막 status=" + st + ")");
  setNext("done");
} else {
  setNext("working");
}

instance.vars.smkPass  = PASS;
instance.vars.smkFail  = FAIL;
instance.vars.smkFails = FAILS;
logInfo("  next=" + instance.vars.smkNext + " / 누적 PASS=" + PASS + " FAIL=" + FAIL);
