/* ============================================================================
 * TBAWFactory / End (Status WF 시그널 — 정상 종료만)
 * ============================================================================
 * 03_Test finish 분기 뒤 End 활동 Advanced JS.
 * 전송 성공분(globalProcessed>0) + 정상 종료(completed|cap_reached) 일 때만
 * targetBulkApiStatusUpdate sigStatus PostEvent.
 *
 * [Main Functions]
 * 1. shouldSendStatusSignal — finishReason·sent 판정
 * 2. 조건부 PostEvent
 *
 * [Dependencies]
 * xtk.workflow.PostEvent, instance.vars (Config·Polling·Distributor)
 * ==========================================================================*/

function NUM(v, def) {
  var n = parseInt(v, 10);
  return isNaN(n) ? (def || 0) : n;
}

var STATUS_WF  = "targetBulkApiStatusUpdate";
var STATUS_SIG = "sigStatus";

var sent   = NUM(instance.vars.globalProcessed, 0);
var reason = String(instance.vars.finishReason || "");

// completed: pending 소진 / cap_reached: GRAND_TOTAL 도달(의도적 중단)
var okReason = (reason === "completed" || reason === "cap_reached");

if (sent > 0 && okReason) {
  logInfo("[End] Status 시그널 발송 — sent=" + sent + " reason=" + reason);
  try {
    xtk.workflow.PostEvent(STATUS_WF, STATUS_SIG, "", <variables/>, false);
    logInfo("[End] PostEvent " + STATUS_WF + "/" + STATUS_SIG + " OK");
  } catch (ePe) {
    logError("[End] Status PostEvent 실패: " + (ePe.message || ePe));
  }
} else {
  logInfo("[End] Status 시그널 생략 — sent=" + sent
    + " reason=" + (reason || "(none)")
    + (reason === "token_expired" ? " (토큰 만료)" : "")
    + (sent <= 0 && reason !== "token_expired" ? " (전송 0건)" : "")
    + (sent > 0 && !okReason ? " (비정상·무처리 종료)" : ""));
}
