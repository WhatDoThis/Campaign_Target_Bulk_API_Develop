/* ============================================================================
 * TBAWFactory / 02_Polling (워커 완료 + pending 잔량 판정)
 * ============================================================================
 * 라운드 완료 후 Sample apiYn='N' 잔량으로 finish/next 결정.
 *
 * [Main Functions]
 * 1. Option 파싱 (STRICT runId)
 * 2. countPending — @apiYn='N' 잔량
 * 3. nextAction: working | next | finish
 *
 * [Dependencies]
 * getOption, xtk.queryDef
 * ==========================================================================*/

function NUM(v, def) { var n = parseInt(v, 10); return isNaN(n) ? (def || 0) : n; }

if (String(instance.vars.nextAction) === "finish") {
  logInfo("[Polling] 종료 상태 — 폴링 생략");
} else {

  var W_COUNT     = NUM(instance.vars.WORKER_COUNT, 3);
  var SCHEMA      = String(instance.vars.MEMBER_SCHEMA);
  var OPT_PREFIX  = String(instance.vars.OPT_PREFIX);
  var RUN_ID      = String(instance.vars.runId || "");
  var STRICT      = (String(instance.vars.STRICT_RUNID) === "true");
  var ABORT_ERR   = (String(instance.vars.ABORT_ON_WORKER_ERROR) === "true");
  var MAX_READY   = NUM(instance.vars.MAX_READY_POLL, 5);
  var MAX_RUN     = NUM(instance.vars.MAX_RUN_POLL, 360);
  var GRAND_TOTAL = NUM(instance.vars.GRAND_TOTAL, 0);

  var poll = NUM(instance.vars.pollCount) + 1;
  instance.vars.pollCount = poll;

  var pendingW = 0;
  var errors   = [];
  var summary  = [];
  var sentSum  = 0;

  var w;
  for (w = 1; w <= W_COUNT; w++) {
    var wName  = String(instance.vars.WORKER_NAME_TPL).replace("{n}", String(w));
    var optKey = OPT_PREFIX + wName;
    var raw = "";
    try { raw = String(getOption(optKey, false) || ""); } catch (e) { raw = ""; }

    var parts  = raw.split("|");
    var optRun = (parts.length > 1) ? parts[0] : "";
    var status = (parts.length > 1) ? parts[1] : parts[0];
    var sent   = (parts.length > 2) ? NUM(parts[2], 0) : 0;

    if (STRICT && RUN_ID !== "" && optRun !== RUN_ID) {
      summary.push(wName + "=stale(" + (status || "none") + ")");
      pendingW++;
      continue;
    }

    summary.push(wName + "=" + (status || "none") + (sent ? ":" + sent : ""));

    if (status === "done" || status === "skip") {
      instance.vars["readyRetry_" + w] = 0;
      if (status === "done") sentSum += sent;
    } else if (status === "error") {
      errors.push(wName);
    } else if (status === "ready") {
      var rc = NUM(instance.vars["readyRetry_" + w]) + 1;
      instance.vars["readyRetry_" + w] = rc;
      if (rc >= MAX_READY) {
        errors.push(wName + "(signal timeout " + rc + ")");
      } else {
        pendingW++;
      }
    } else {
      instance.vars["readyRetry_" + w] = 0;
      pendingW++;
    }
  }

  logInfo("[Polling #" + poll + "] " + summary.join(", "));

  if (pendingW > 0 && poll >= MAX_RUN) {
    errors.push("ROUND_TIMEOUT(poll " + poll + ")");
    pendingW = 0;
  }

  if (errors.length > 0) {
    var msg = "[Polling] 워커 이상: " + errors.join(", ");
    if (ABORT_ERR) {
      logError(msg + " → 중단");
      throw new Error(msg);
    }
    logWarning(msg + " → 계속 (apiYn=N 잔여는 다음 라운드)");
  }

  if (pendingW > 0) {
    instance.vars.nextAction = "working";
    logInfo("[Polling] 워커 진행 중 (" + pendingW + "개)");
  } else {
    var processed = NUM(instance.vars.globalProcessed) + sentSum;
    instance.vars.globalProcessed = processed;
    logInfo("=== Round " + instance.vars.round + " 워커 완료 / sent="
      + sentSum + " / 누적 " + processed + " ===");

    // (변경) sent 누적만으로 finish 하지 않음. Sample pending 잔량 기준
    var pendingRows = -1;
    try {
      var c = xtk.queryDef.create(
        <queryDef schema={SCHEMA} operation="count">
          <where><condition expr="@apiYn = 'N'"/></where>
        </queryDef>
      ).ExecuteQuery();
      pendingRows = parseInt(c.@count, 10) || 0;
    } catch (eCnt) {
      logError("[Polling] pending count 실패: " + (eCnt.message || eCnt));
    }

    instance.vars.pendingRows = pendingRows;
    logInfo("[Polling] Sample pending=" + pendingRows);

    if (pendingRows === 0) {
      instance.vars.nextAction = "finish";
      logInfo("[Polling] 미전송 0건 → finish");
    } else if (GRAND_TOTAL > 0 && processed >= GRAND_TOTAL) {
      instance.vars.nextAction = "finish";
      logWarning("[Polling] GRAND_TOTAL(" + GRAND_TOTAL + ") 도달. "
        + "미전송 " + pendingRows + "건 잔존 → 다음 실행");
    } else if (pendingRows < 0) {
      instance.vars.nextAction = "next";
      logWarning("[Polling] count 실패 → next (재분배)");
    } else {
      instance.vars.nextAction = "next";
      logInfo("[Polling] 미전송 " + pendingRows + "건 → next");
    }
  }
}
