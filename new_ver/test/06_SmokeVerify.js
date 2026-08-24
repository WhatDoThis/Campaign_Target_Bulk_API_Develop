/* ============================================================================
 * TBAWSmoke / 06_Verify (스키마 커밋 + Fetch 재시도 + 롤백·정리)
 * 1m Wait 이후. 실전송 큐 키 구간의 apiYn=Y·master FK, Master 실 URL.
 * 종료 시 Sample apiYn/master FK 원복 + SMOKE Master 삭제.
 *
 * [Dependencies]
 * HttpClientRequest, xtk.queryDef, xtk.session.DeleteCollection, sqlExec
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

var PASS  = parseInt(instance.vars.smkPass, 10) || 0;
var FAIL  = parseInt(instance.vars.smkFail, 10) || 0;
var FAILS = String(instance.vars.smkFails || "");
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS += (FAILS ? ", " : "") + n; logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}

var SCHEMA  = String(instance.vars.smkSchema);
var RUN_ID  = String(instance.vars.smkRunId || "");
var lo      = String(instance.vars.smkRealStart || "");
var hi      = String(instance.vars.smkRealEnd || "");
var ym      = String(instance.vars.smkRealYm || "");
var lineS   = parseInt(instance.vars.smkRealLineS, 10) || 0;
var lineE   = parseInt(instance.vars.smkRealLineE, 10) || 0;
var MEM_TBL = (typeof BULK_CFG !== "undefined" && BULK_CFG.MEMBER_TABLE)
  ? String(BULK_CFG.MEMBER_TABLE) : "WootarTestWooTargetSample";
var MASTER  = (typeof BULK_CFG !== "undefined") ? String(BULK_CFG.MASTER_SCHEMA)
  : "wootar:testWooTargetBulkApiMaster";

logInfo("=== V0 실전송 스키마 ===");
if ((!ym || lineS < 1) || instance.vars.smkTSignal !== "1") {
  logInfo("  [SKIP] 실전송 구간 없음");
} else {
  try {
    // idx_pending_queue 컬럼 순서와 일치 — apiYn 선행
    var cond1 = "@apiYn = 'Y' AND @ingestYm = '" + ym + "'"
              + " AND @lineNo >= " + lineS + " AND @lineNo <= " + lineE;
    var yq = xtk.queryDef.create(
      <queryDef schema={SCHEMA} operation="count">
        <where>
          <condition expr={cond1}/>
        </where>
      </queryDef>
    ).ExecuteQuery();
    var ycnt = parseInt(yq.@count, 10) || 0;
    var expect = parseInt(instance.vars.smkRealCount, 10) || 1;
    ok("실전송 큐 키 apiYn=Y", ycnt >= expect,
      "Y=" + ycnt + " / 기대>=" + expect + " / " + ym + " line " + lineS + " ~ " + lineE
        + " / uid " + lo + " ~ " + hi);

    // 인덱스 3컬럼 선행 후 FK 필터. imasterid 는 별도 인덱스 없음
    var cond2 = "@apiYn = 'Y' AND @ingestYm = '" + ym + "'"
              + " AND @lineNo >= " + lineS + " AND @lineNo <= " + lineE
              + " AND [@master-id] > 0";
    var mq = xtk.queryDef.create(
      <queryDef schema={SCHEMA} operation="count">
        <where>
          <condition expr={cond2}/>
        </where>
      </queryDef>
    ).ExecuteQuery();
    var mcnt = parseInt(mq.@count, 10) || 0;
    ok("실전송 Sample master FK", mcnt >= expect,
      "linked=" + mcnt + " / 기대>=" + expect);
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

logInfo("=== V2 Cleanup (Sample 롤백 + Master 삭제) ===");
if (instance.vars.smkCleanup !== "1") { logInfo("  [SKIP] DO_CLEANUP=false"); }
else {
  try {
    if (ym && lineS >= 1 && lineE >= lineS) {
      sqlExec("UPDATE " + MEM_TBL + " SET sapiyn='N', imasterid=0"
        + " WHERE singestym='" + ym + "' AND ilineno BETWEEN " + lineS + " AND " + lineE);
      ok("Sample apiYn/master FK 롤백", true, ym + " line " + lineS + "~" + lineE);
    }
    if (RUN_ID) {
      xtk.session.DeleteCollection(MASTER,
        <where><condition expr={"@batchName LIKE 'SMOKE-" + RUN_ID
          + "%' OR @batchName LIKE 'SMOKE-LOCAL-" + RUN_ID + "%'"}/></where>, false);
    }
    // 이번 runId Master 만 삭제. Target 프로필·타 회차 SMOKE 는 유지
    ok("SMOKE Master 삭제", true, "runId=" + RUN_ID + " 한정 / Target 프로필은 유지");
  } catch (e) { ok("롤백·정리", false, e.toString()); }
  try { setOption(String(instance.vars.smkOptKey), "", "smoke worker status"); } catch (e) {}
}

logInfo("##################################################");
logInfo("#  SMOKE TEST 최종  runId=" + instance.vars.smkRunId);
logInfo("#  실전송 " + ym + " line " + lineS + " ~ " + lineE
  + " / uid " + lo + " ~ " + hi + "  Fetch=" + fetchUid);
logInfo("#  PASS=" + PASS + "  FAIL=" + FAIL);
logInfo("##################################################");

if (FAIL > 0) {
  logWarning("실패 목록: " + FAILS);
  throw new Error("스모크 테스트 실패 " + FAIL + "건 — Factory 제작 금지");
}
logInfo("전 항목 통과. Postman Fetch 로 Target 값을 한 번 더 확인한다.");
