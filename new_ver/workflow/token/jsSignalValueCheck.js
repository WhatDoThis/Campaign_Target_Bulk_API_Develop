/* ============================================================================
 * targetBulkApiTokenExpireNotification / jsSignalValueCheck (시그널 vars 확인)
 * ============================================================================
 * sigTokenExpire 직후 Advanced JS. Factory 00_Config 가 계산·전달한 vars 수신·로그.
 * 만료 판정은 Config(todayYmd 기준). 본 활동은 수신값 표시·instance.vars 전파만.
 *
 * PostEvent vars:
 *   tokenCreatedYmd, tokenExpireYmd, tokenDaysLeft, tokenPhase,
 *   tokenValidDays, tokenAsOfYmd, sessionRunId
 *
 * [Main Functions]
 * 1. resolveTokenSignalParams
 * 2. logTokenSignalParams
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js (resolveBizDate — 오늘 표시용)
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

function resolveTokenSignalParams(raw, inst) {
  var src = raw;
  if (typeof inst !== "undefined" && inst.vars) {
    if (String(raw.tokenExpireYmd || "") === "" && String(inst.vars.tokenExpireYmd || "") !== "") {
      src = inst.vars;
    }
  }
  return {
    tokenCreatedYmd: String(src.tokenCreatedYmd || ""),
    tokenExpireYmd:  String(src.tokenExpireYmd || ""),
    tokenDaysLeft:   String(src.tokenDaysLeft !== undefined && src.tokenDaysLeft !== null
      ? src.tokenDaysLeft : ""),
    tokenPhase:      String(src.tokenPhase || ""),
    tokenValidDays:  String(src.tokenValidDays || ""),
    tokenAsOfYmd:    String(src.tokenAsOfYmd || ""),
    sessionRunId:    String(src.sessionRunId || "")
  };
}

var P = resolveTokenSignalParams(
  (typeof vars !== "undefined") ? vars : {},
  (typeof instance !== "undefined") ? instance : null
);
var todayYmd = BulkApiWorker.resolveBizDate("");

logInfo("[TokenNotify] created=" + P.tokenCreatedYmd
  + " expire=" + P.tokenExpireYmd
  + " left=" + P.tokenDaysLeft
  + " phase=" + P.tokenPhase
  + " validDays=" + P.tokenValidDays
  + " asOf=" + P.tokenAsOfYmd
  + " today=" + todayYmd
  + " sessionRunId=" + P.sessionRunId);

if (typeof instance !== "undefined" && instance.vars) {
  instance.vars.tokenCreatedYmd = P.tokenCreatedYmd;
  instance.vars.tokenExpireYmd  = P.tokenExpireYmd;
  instance.vars.tokenDaysLeft   = P.tokenDaysLeft;
  instance.vars.tokenPhase      = P.tokenPhase;
  instance.vars.tokenValidDays  = P.tokenValidDays;
  instance.vars.tokenAsOfYmd    = P.tokenAsOfYmd;
  instance.vars.sessionRunId    = P.sessionRunId;
  instance.vars.todayYmd        = todayYmd;
}
