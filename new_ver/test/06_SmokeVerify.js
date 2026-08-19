/* ============================================================================
 * TBAWSmoke / 06_Verify — batchStatus 확인 + 흔적 정리 + 최종 판정
 * ==========================================================================*/

var PASS  = parseInt(instance.vars.smkPass, 10) || 0;
var FAIL  = parseInt(instance.vars.smkFail, 10) || 0;
var FAILS = String(instance.vars.smkFails || "");
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS += (FAILS ? ", " : "") + n; logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}

/* --- [V1] batchStatus 폴링 ---------------------------------------------- */
logInfo("=== V1 Batch Status ===");
var su = String(instance.vars.smkStatusUrl || "");
if (su === "") { logInfo("  [SKIP] statusUrl 없음"); }
else {
  try {
    var url = su + (su.indexOf("?") >= 0 ? "&" : "?") + "showDetails=true";
    var req = new HttpClientRequest(url);
    req.method = "GET";
    req.execute();
    var raw = String(req.response.body || "");
    logInfo("  code=" + req.response.code + " body=" + raw);

    function pick(t) { var m = raw.match(new RegExp("<" + t + ">([^<]*)</" + t + ">", "i")); return m ? m[1] : ""; }
    var st = pick("status");
    ok("status 조회 성공", req.response.code === 200, "code=" + req.response.code);
    ok("status 값 정상", st === "complete" || st === "incomplete",
       "status=" + st + (st === "stuck" ? " ← Target 측 처리 실패" : ""));
    ok("batchSize 파싱", pick("batchSize") !== "", "batchSize=" + pick("batchSize"));
    logInfo("  consumed=" + pick("consumedCount")
          + " success=" + pick("successfulUpdates")
          + " notFound=" + pick("profilesNotFound")
          + " failed="   + pick("failedUpdates"));
    if (st === "incomplete") logInfo("  ※ 최대 24시간까지 incomplete 가능 — 정상 범주");
  } catch (e) { ok("V1 Batch Status", false, e.toString()); }
}

/* --- [V2] 흔적 정리 (Detail → Master 순) --------------------------------- */
logInfo("=== V2 Cleanup ===");
if (instance.vars.smkCleanup !== "1") { logInfo("  [SKIP] DO_CLEANUP=false"); }
else {
  try {
    xtk.session.DeleteCollection("wootar:testWooTargetBulkApiDetail",
      <where><condition expr="@membershipUid LIKE 'SMK%'"/></where>, false);
    xtk.session.DeleteCollection("wootar:testWooTargetBulkApiMaster",
      <where><condition expr="@batchName LIKE 'SMOKE%'"/></where>, false);
    ok("DB 흔적 삭제", true);
  } catch (e) { ok("DB 흔적 삭제", false, e.toString()); }
  try { setOption(String(instance.vars.smkOptKey), "", "smoke worker status"); } catch (e) {}
}

/* --- [V3] 최종 판정 ------------------------------------------------------ */
logInfo("##################################################");
logInfo("#  SMOKE TEST 최종  runId=" + instance.vars.smkRunId);
logInfo("#  PASS=" + PASS + "  FAIL=" + FAIL);
logInfo("##################################################");

if (FAIL > 0) {
  logWarning("실패 목록: " + FAILS);
  throw new Error("스모크 테스트 실패 " + FAIL + "건 — 본 배치 실행 금지");
}
logInfo("전 항목 통과. 본 배치 실행 가능.");
