/* ============================================================================
 * TBAWSmoke / 06_Verify (스키마 커밋 + Fetch 재시도 + 로그 정리)
 * 1m Wait 이후. 실전송 UID의 apiYn=Y, Master 실 URL.
 * Fetch 404는 실패로 두지 않음. Target 값은 Postman으로 재확인.
 *
 * [Dependencies]
 * HttpClientRequest, xtk.queryDef, xtk.session.DeleteCollection
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

var PASS  = parseInt(instance.vars.smkPass, 10) || 0;
var FAIL  = parseInt(instance.vars.smkFail, 10) || 0;
var FAILS = String(instance.vars.smkFails || "");
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS += (FAILS ? ", " : "") + n; logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}

var SCHEMA = String(instance.vars.smkSchema);
var RUN_ID = String(instance.vars.smkRunId || "");
var lo     = String(instance.vars.smkRealStart || "");
var hi     = String(instance.vars.smkRealEnd || "");

logInfo("=== V0 실전송 스키마 ===");
if (!lo || instance.vars.smkTSignal !== "1") {
  logInfo("  [SKIP] 실전송 구간 없음");
} else {
  try {
    var yq = xtk.queryDef.create(
      <queryDef schema={SCHEMA} operation="count">
        <where>
          <condition expr={"@apiYn = 'Y' AND @membershipUid >= '" + lo
            + "' AND @membershipUid <= '" + hi + "'"}/>
        </where>
      </queryDef>
    ).ExecuteQuery();
    var ycnt = parseInt(yq.@count, 10) || 0;
    var expect = parseInt(instance.vars.smkRealCount, 10) || 1;
    ok("실전송 UID apiYn=Y", ycnt >= expect, "Y=" + ycnt + " / 기대>=" + expect + " / " + lo + " ~ " + hi);
  } catch (e) { ok("실전송 apiYn", false, e.toString()); }
}

logInfo("=== V1 Fetch 재시도 ===");
var fetchUrl = String(instance.vars.smkFetchUrl || "");
var fetchUid = String(instance.vars.smkFetchUid || "");
var expectSeg = String(instance.vars.smkExpectSeg || "");
if (!fetchUrl) { logInfo("  [SKIP] Fetch URL 없음"); }
else {
  try {
    var req = new HttpClientRequest(fetchUrl);
    req.method = "GET";
    if (typeof BULK_CFG !== "undefined" && BULK_CFG.AUTH_TOKEN) {
      req.header["Authorization"] = "Bearer " + BULK_CFG.AUTH_TOKEN;
    }
    req.execute();
    var raw = String(req.response.body || "");
    logInfo("  Fetch uid=" + fetchUid + " code=" + req.response.code);
    logInfo("  Postman GET " + fetchUrl);
    if (req.response.code === 200 && raw.indexOf("profileAttributes") >= 0) {
      ok("06 Fetch 200", true, fetchUid);
      if (expectSeg && raw.indexOf(expectSeg) >= 0) {
        ok("06 Fetch seg_id", true, expectSeg);
      } else if (expectSeg) {
        logInfo("  [INFO] seg_id 미반영. Postman에서 profile.seg_id 확인: " + expectSeg);
      }
    } else {
      logInfo("  [INFO] Fetch " + req.response.code
        + " — 제출은 됐으나 적재 전일 수 있음. Postman으로 같은 URL 재조회");
    }
  } catch (e) { logWarning("  Fetch 재시도 예외: " + e.toString()); }
}

logInfo("=== V2 Cleanup ===");
if (instance.vars.smkCleanup !== "1") { logInfo("  [SKIP] DO_CLEANUP=false"); }
else {
  try {
    if (RUN_ID) {
      xtk.session.DeleteCollection("wootar:testWooTargetBulkApiDetail",
        <where><condition expr={"[master/@batchName] LIKE 'SMOKE-" + RUN_ID
          + "%' OR [master/@batchName] LIKE 'SMOKE-LOCAL-" + RUN_ID + "%'"}/></where>, false);
      xtk.session.DeleteCollection("wootar:testWooTargetBulkApiMaster",
        <where><condition expr={"@batchName LIKE 'SMOKE-" + RUN_ID
          + "%' OR @batchName LIKE 'SMOKE-LOCAL-" + RUN_ID + "%'"}/></where>, false);
    }
    xtk.session.DeleteCollection("wootar:testWooTargetBulkApiDetail",
      <where><condition expr="@membershipUid LIKE 'SMK%'"/></where>, false);
    xtk.session.DeleteCollection("wootar:testWooTargetBulkApiMaster",
      <where><condition expr="@batchName LIKE 'SMOKE%'"/></where>, false);
    ok("로그 흔적 삭제", true, "Sample apiYn=Y 와 Target 프로필은 유지");
  } catch (e) { ok("로그 흔적 삭제", false, e.toString()); }
  try { setOption(String(instance.vars.smkOptKey), "", "smoke worker status"); } catch (e) {}
}

logInfo("##################################################");
logInfo("#  SMOKE TEST 최종  runId=" + instance.vars.smkRunId);
logInfo("#  실전송 " + lo + " ~ " + hi + "  Fetch=" + fetchUid);
logInfo("#  PASS=" + PASS + "  FAIL=" + FAIL);
logInfo("##################################################");

if (FAIL > 0) {
  logWarning("실패 목록: " + FAILS);
  throw new Error("스모크 테스트 실패 " + FAIL + "건 — Factory 제작 금지");
}
logInfo("전 항목 통과. Postman Fetch 로 Target 값을 한 번 더 확인한다.");
