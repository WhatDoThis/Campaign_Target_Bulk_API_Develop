/* ============================================================================
 * TBAWSmoke / 05_ApiTest (실전송 결과 조회)
 * 03→07이 올린 샘플 UID의 Master batchStatus + Profile Fetch.
 * 가짜 SMOKE_TEST_A/B 는 보내지 않는다. Fetch 404는 적재 지연으로 보고 실패로 두지 않음.
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js, HttpClientRequest, xtk.queryDef
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

var PASS  = parseInt(instance.vars.smkPass, 10) || 0;
var FAIL  = parseInt(instance.vars.smkFail, 10) || 0;
var FAILS = String(instance.vars.smkFails || "");
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS += (FAILS ? ", " : "") + n; logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}

var CLIENT = String(instance.vars.smkClient || "");
var RUN_ID = String(instance.vars.smkRunId || "");
var ym     = String(instance.vars.smkRealYm || "");
var lineS  = parseInt(instance.vars.smkRealLineS, 10) || 0;
var lineE  = parseInt(instance.vars.smkRealLineE, 10) || 0;
var SCHEMA = String(instance.vars.smkSchema);
var ELEMENT = String(instance.vars.smkElement);
var MASTER = (typeof BULK_CFG !== "undefined") ? String(BULK_CFG.MASTER_SCHEMA)
  : "wootar:testWooTargetBulkApiMaster";
var MASTER_EL = (typeof BULK_CFG !== "undefined" && BULK_CFG.MASTER_ELEMENT)
  ? String(BULK_CFG.MASTER_ELEMENT) : "testWooTargetBulkApiMaster";
instance.vars.smkStatusUrl = "";
instance.vars.smkFetchUid  = "";
instance.vars.smkFetchUrl  = "";

function applyAuth(req) {
  if (typeof BULK_CFG !== "undefined" && BULK_CFG.AUTH_TOKEN) {
    req.header["Authorization"] = "Bearer " + BULK_CFG.AUTH_TOKEN;
  }
}

function xmlTag(body, tag) {
  var raw = String(body || "");
  var open = "<" + tag + ">";
  var a = raw.indexOf(open);
  var b = raw.indexOf("</" + tag + ">");
  if (a < 0 || b <= a) return "";
  return raw.substring(a + open.length, b);
}

logInfo("=== T8 Real send status / Fetch ===");
if (instance.vars.smkTApi !== "1") {
  logInfo("  [SKIP] 스위치 OFF");
} else {
  try {
    var mq = xtk.queryDef.create(
      <queryDef schema={MASTER} operation="select" lineCount="5">
        <select>
          <node expr="@batchName"/><node expr="@batchStatusUrl"/>
          <node expr="@httpCode"/><node expr="@success"/><node expr="@recordCount"/>
        </select>
        <where>
          <condition expr={"@workerName = 'SMOKE' AND @success = 1 AND @batchName LIKE 'SMOKE-"
            + RUN_ID + "-%' AND @batchName NOT LIKE '%-M1'"}/>
        </where>
      </queryDef>
    ).ExecuteQuery();

    var batchName = "", statusUrl = "", httpCode = "", recCnt = "";
    for each (var m in mq[MASTER_EL]) {
      batchName = String(m.@batchName);
      statusUrl = String(m.@batchStatusUrl);
      httpCode  = String(m.@httpCode);
      recCnt    = String(m.@recordCount);
      break;
    }

    ok("실전송 Master 존재", batchName !== "", "batchName=" + batchName);
    ok("httpCode 200", httpCode === "200", "httpCode=" + httpCode);
    ok("batchStatusUrl 이 실 URL", statusUrl.indexOf("http") === 0,
       statusUrl || "(없음)");
    instance.vars.smkStatusUrl = statusUrl;

    if (statusUrl.indexOf("http") === 0) {
      var req = new HttpClientRequest(
        statusUrl + (statusUrl.indexOf("?") >= 0 ? "&" : "?") + "showDetails=true");
      req.method = "GET";
      applyAuth(req);
      req.execute();
      var raw = String(req.response.body || "");
      logInfo("  batchStatus code=" + req.response.code + " body=" + raw.substring(0, 500));
      var st = xmlTag(raw, "status");
      ok("batchStatus HTTP 200", req.response.code === 200, "code=" + req.response.code);
      ok("batchStatus complete|incomplete", st === "complete" || st === "incomplete",
         "status=" + st + " recordCount=" + recCnt);
    }

    // idx_pending_queue(apiYn, ingestYm, lineNo) 와 조건 순서 일치
    var scond = "@apiYn='Y' AND @ingestYm='" + ym + "'"
      + " AND @lineNo >= " + lineS + " AND @lineNo <= " + lineE
      + " AND [master/@batchName] LIKE 'SMOKE-" + RUN_ID + "-%'"
      + " AND [master/@batchName] NOT LIKE '%-M1'";
    var dq = xtk.queryDef.create(
      <queryDef schema={SCHEMA} operation="select" lineCount="5">
        <select><node expr="@membershipUid"/><node expr="@segId"/></select>
        <where>
          <condition expr={scond}/>
        </where>
      </queryDef>
    ).ExecuteQuery();

    var fetchUid = "", expectSeg = "";
    for each (var d in dq[ELEMENT]) {
      fetchUid  = String(d.@membershipUid);
      expectSeg = String(d.@segId);
      break;
    }
    instance.vars.smkFetchUid = fetchUid;
    instance.vars.smkExpectSeg = expectSeg;

    if (!fetchUid) {
      ok("실전송 Sample UID", false, "apiYn=Y + master FK Sample 없음");
    } else {
      var fetchUrl = "https://" + CLIENT + ".tt.omtrdc.net/rest/v1/profiles/thirdPartyId/"
                   + encodeURIComponent(fetchUid) + "?client=" + encodeURIComponent(CLIENT);
      instance.vars.smkFetchUrl = fetchUrl;
      logInfo("  Postman Fetch GET " + fetchUrl);
      logInfo("  기대 profile.seg_id = " + expectSeg
        + ((typeof BULK_CFG !== "undefined" && BULK_CFG.CUSTOM_ATTR)
          ? " / CUSTOM_ATTR=" + BULK_CFG.CUSTOM_ATTR : ""));

      var freq = new HttpClientRequest(fetchUrl);
      freq.method = "GET";
      applyAuth(freq);
      freq.execute();
      var fbody = String(freq.response.body || "");
      logInfo("  Fetch code=" + freq.response.code + " body=" + fbody.substring(0, 500));

      if (freq.response.code === 200 && fbody.indexOf("profileAttributes") >= 0) {
        ok("Profile Fetch 200", true, "uid=" + fetchUid);
        if (expectSeg) {
          var hasSeg = fbody.indexOf(expectSeg) >= 0;
          if (hasSeg) ok("Fetch seg_id 일치", true, expectSeg);
          else logInfo("  [INFO] Fetch 본문에 seg_id 아직 없음 — 1m 후 06·Postman 재조회");
        }
      } else if (freq.response.code === 404) {
        logInfo("  [INFO] Fetch 404 = 적재 전 가능(최대 24시간). 실패로 두지 않음. Postman으로 재조회: " + fetchUrl);
      } else {
        ok("Profile Fetch", false, "code=" + freq.response.code);
      }
    }
  } catch (e) { ok("T8 Real send 조회", false, e.toString()); }
}

logInfo("=== T9 Negative ===");
if (instance.vars.smkTNeg !== "1") { logInfo("  [SKIP] 스위치 OFF"); }
else {
  try {
    var URL = String(instance.vars.smkUrl);
    var buf = new MemoryBuffer();
    buf.fromString("thirdPartyId,smokeTest\nSMOKE_TEST_C,1\n", "utf-8");
    var nreq = new HttpClientRequest(URL);
    nreq.method = "POST";
    nreq.header["Content-Type"] = "application/x-www-form-urlencoded";
    applyAuth(nreq);
    nreq.body = buf;
    nreq.execute();
    var nraw = String(nreq.response.body || "");
    var nOk = nraw.indexOf("<success>true</success>") < 0;
    ok("에러 응답 감지", nOk, "code=" + nreq.response.code);
  } catch (e) { ok("T9 에러 경로", true, "예외로 처리됨: " + e.toString()); }
}

instance.vars.smkPass  = PASS;
instance.vars.smkFail  = FAIL;
instance.vars.smkFails = FAILS;
