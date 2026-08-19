/* ============================================================================
 * TBAWSmoke / 05_ApiTest — 실 엔드포인트 2건 + 실패 유도 1건
 *   Content-Type / MemoryBuffer 는 워커와 완전히 동일하게 맞춘다.
 *   (여기서만 text/plain 을 쓰면 "테스트는 되는데 본 배치는 안 되는" 상황이 생김)
 * ==========================================================================*/

var PASS  = parseInt(instance.vars.smkPass, 10) || 0;
var FAIL  = parseInt(instance.vars.smkFail, 10) || 0;
var FAILS = String(instance.vars.smkFails || "");
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS += (FAILS ? ", " : "") + n; logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}

var URL   = String(instance.vars.smkUrl);
var runId = String(instance.vars.smkRunId);
instance.vars.smkStatusUrl = "";

function post(body, label) {
  var buf = new MemoryBuffer();
  buf.fromString(body, "utf-8");
  var req = new HttpClientRequest(URL);
  req.method = "POST";
  req.header["Content-Type"] = "application/x-www-form-urlencoded";
  req.body = buf;
  req.execute();
  var raw = String(req.response.body || "");
  logInfo("  [" + label + "] code=" + req.response.code + " body=" + raw.substring(0, 400));
  var s = raw.indexOf("<batchStatus>"), e = raw.indexOf("</batchStatus>");
  return { code: req.response.code,
           success: raw.indexOf("<success>true</success>") >= 0,
           statusUrl: (s > -1 && e > s) ? raw.substring(s + 13, e) : "",
           raw: raw };
}

logInfo("=== T8 Real API ===");
if (instance.vars.smkTApi !== "1") { logInfo("  [SKIP] 스위치 OFF"); }
else {
  try {
    var body = "batch=thirdPartyId,smokeTest,smokeRunId\n"
             + "SMOKE_TEST_A," + encodeURIComponent("1") + "," + encodeURIComponent(runId) + "\n"
             + "SMOKE_TEST_B," + encodeURIComponent("1") + "," + encodeURIComponent(runId) + "\n";
    var r = post(body, "정상");
    ok("HTTP 200", r.code === 200, "code=" + r.code);
    ok("success=true 파싱", r.success === true);
    ok("batchStatus URL 회수", r.statusUrl !== "", r.statusUrl);
    ok("batchStatusUrl 255자 이내", r.statusUrl.length <= 255, "len=" + r.statusUrl.length);
    instance.vars.smkStatusUrl = r.statusUrl;
  } catch (e) { ok("T8 Real API", false, e.toString()); }
}

logInfo("=== T9 Negative ===");
if (instance.vars.smkTNeg !== "1") { logInfo("  [SKIP] 스위치 OFF"); }
else {
  try {
    // batch= 프리픽스 누락. Target의 실제 반응을 기록하는 것이 목적이다.
    var r2 = post("thirdPartyId,smokeTest\nSMOKE_TEST_C,1\n", "실패유도");
    ok("에러 응답 감지", r2.success === false,
       "code=" + r2.code + " success=" + r2.success + " ← 워커 판정 로직 튜닝 근거");
  } catch (e) { ok("T9 에러 경로", true, "예외로 처리됨: " + e.toString()); }
}

instance.vars.smkPass  = PASS;
instance.vars.smkFail  = FAIL;
instance.vars.smkFails = FAILS;
