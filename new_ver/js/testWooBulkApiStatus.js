// ============================================================
// wootar:testWooBulkApiStatus.js (Target batchStatus 재조회)
// ------------------------------------------------------------
// 전송 워커가 남긴 Master.batchStatusUrl 을 나중에 GET 한다.
// 제출 success/apiYn 은 바꾸지 않음. 공식 status: complete / incomplete / stuck.
//
// [Main Functions]
// 1. fetchChunk / countPending — 확인 대상 Master
// 2. getStatus — showDetails=true GET + 429/503 재시도 (STATUS_CPM=5 예산)
// 3. updateIngest — Master 적재 컬럼만 갱신
// 4. runChunk — 한 활동에서 CHUNK_SIZE 건
//
// [Dependencies]
// wootar:testWooBulkApiWorker.js (BULK_CFG: 스키마·토큰·한도)
// xtk.queryDef, xtk.session, HttpClientRequest
// [참조] https://experienceleague.adobe.com/en/docs/target-dev/developer/api/profile-apis/profile-bulk-api
// ============================================================

loadLibrary("wootar:testWooBulkApiWorker.js", false);

var STATUS_CFG = {

  // 한 JS 활동에서 GET 할 Master 수. 20 × 약 1.7초 ≈ 35초
  CHUNK_SIZE         : 20,

  // 공식 적재 상한 24시간. 그 뒤에도 incomplete 면 로컬 stuck
  STUCK_AFTER_HOURS  : 24,

  // Test working 최대 횟수 (Wait 1m). 180 = 3시간
  MAX_RUN_POLL       : 180,

  // 한 청크에서 GET 이 연속 실패하면 나머지 행은 다음 사이클로
  MAX_CONSEC_FAIL    : 5,

  // Status GET 레이트 예산 (Target status API 5 calls/min 기준)
  STATUS_CPM         : 5,
  SAFETY_RATIO       : 0.9,

  GET_RETRY          : 3
};


function BulkStatusChecker() {
  if (typeof BULK_CFG === "undefined") {
    throw new Error("[Status] BULK_CFG 없음 — 전송 라이브러리 내부명 확인");
  }
  this.authToken = String(BULK_CFG.AUTH_TOKEN || "").replace(/^\s+|\s+$/g, "");
  this.lastCallMs = 0;
  var cpm = (parseFloat(STATUS_CFG.STATUS_CPM) || 5) * (parseFloat(STATUS_CFG.SAFETY_RATIO) || 0.9);
  if (!(cpm > 0)) cpm = 1;
  this.MIN_INTERVAL_MS = Math.ceil(60000 / cpm);
  this.schema  = String(BULK_CFG.MASTER_SCHEMA);
  this.element = String(BULK_CFG.MASTER_ELEMENT);
}

// # 1. [Util]
BulkStatusChecker.prototype.sqlLit = function(s) {
  return String(s === undefined || s === null ? "" : s).replace(/'/g, "''");
};

BulkStatusChecker.prototype.xmlTag = function(body, tag) {
  var raw = String(body || "");
  var open = "<" + tag + ">";
  var start = raw.indexOf(open);
  var end = raw.indexOf("</" + tag + ">");
  if (start < 0 || end <= start) return "";
  return raw.substring(start + open.length, end);
};

BulkStatusChecker.prototype.pendingExpr = function() {
  return "@success = 1"
    + " AND @batchStatusUrl LIKE 'http%'"
    + " AND (@batchStatus IS NULL OR @batchStatus = '' OR @batchStatus = 'incomplete')";
};

BulkStatusChecker.prototype.ageHours = function(created) {
  if (!created) return 0;
  var t = new Date(String(created)).getTime();
  if (!(t > 0)) return 0;
  return (new Date().getTime() - t) / 3600000;
};

// 공식 3값만 Master enum 에 기록. unknown 등 → incomplete 로 재조회
BulkStatusChecker.prototype.normalizeStatus = function(raw) {
  var st = String(raw || "").replace(/^\s+|\s+$/g, "");
  if (st === "complete" || st === "stuck" || st === "incomplete") return st;
  return "incomplete";
};

BulkStatusChecker.prototype.throttle = function() {
  var now = new Date().getTime();
  if (this.lastCallMs === 0) {
    this.lastCallMs = now;
    return 0;
  }
  var gap = now - this.lastCallMs;
  var wait = 0;
  if (gap < this.MIN_INTERVAL_MS) {
    wait = this.MIN_INTERVAL_MS - gap;
    logInfo("[Status] 스로틀 " + wait + "ms");
    sleep(wait);
  }
  this.lastCallMs = new Date().getTime();
  return wait;
};

// # 2. [Query]
BulkStatusChecker.prototype.fetchChunk = function() {
  var n = parseInt(STATUS_CFG.CHUNK_SIZE, 10) || 20;
  var SCHEMA = this.schema;
  var COND = this.pendingExpr();
  var q = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select" lineCount={String(n)}>
      <select>
        <node expr="@id"/><node expr="@batchName"/><node expr="@workerName"/>
        <node expr="@runId"/><node expr="@recordCount"/><node expr="@httpCode"/>
        <node expr="@success"/><node expr="@attemptCount"/><node expr="@elapsedMs"/>
        <node expr="@batchStatusUrl"/><node expr="@errorMessage"/>
        <node expr="@batchStatus"/><node expr="@createdDate"/>
      </select>
      <where><condition expr={COND}/></where>
      <orderBy><node expr="@createdDate" sortDesc="false"/></orderBy>
    </queryDef>
  ).ExecuteQuery();
  var rows = [];
  for each (var r in q[this.element]) {
    rows.push({
      id:         parseInt(r.@id, 10) || 0,
      batchName:  String(r.@batchName),
      workerName: String(r.@workerName),
      runId:      String(r.@runId),
      recordCount: parseInt(String(r.@recordCount), 10) || 0,
      httpCode:   parseInt(String(r.@httpCode), 10) || 0,
      success:    String(r.@success),
      attemptCount: parseInt(String(r.@attemptCount), 10) || 0,
      elapsedMs:  parseInt(String(r.@elapsedMs), 10) || 0,
      url:        String(r.@batchStatusUrl),
      errorMessage: String(r.@errorMessage || ""),
      prevStatus: String(r.@batchStatus || ""),
      createdDate: String(r.@createdDate || "")
    });
  }
  return rows;
};

BulkStatusChecker.prototype.countPending = function() {
  var SCHEMA = this.schema;
  var COND = this.pendingExpr();
  var c = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="count">
      <where><condition expr={COND}/></where>
    </queryDef>
  ).ExecuteQuery();
  return parseInt(c.@count, 10) || 0;
};

// # 3. [GET]
BulkStatusChecker.prototype.getOnce = function(url) {
  this.throttle();
  var req = new HttpClientRequest(url);
  req.method = "GET";
  if (this.authToken) req.header["Authorization"] = "Bearer " + this.authToken;
  req.execute();
  var code = req.response.code;
  var body = String(req.response.body || "");
  return { code: code, body: body };
};

BulkStatusChecker.prototype.statusUrl = function(rawUrl) {
  var url = String(rawUrl || "");
  if (url.indexOf("http") !== 0 || url === "DRYRUN") return "";
  if (url.indexOf("showDetails=") < 0) {
    url += (url.indexOf("?") >= 0 ? "&" : "?") + "showDetails=true";
  }
  return url;
};

BulkStatusChecker.prototype.getStatus = function(rawUrl) {
  var url = this.statusUrl(rawUrl);
  if (!url) return { ok: false, reason: "url" };

  var retry = parseInt(STATUS_CFG.GET_RETRY, 10) || 3;
  var attempt, last = { ok: false, reason: "retry" };
  for (attempt = 1; attempt <= retry; attempt++) {
    var res;
    try {
      res = this.getOnce(url);
    } catch (e) {
      last = { ok: false, reason: String(e.message || e) };
      break;
    }
    if (res.code === 429) {
      logWarning("[Status] HTTP 429 → " + (BULK_CFG.WAIT_429_MS / 1000) + "s");
      sleep(BULK_CFG.WAIT_429_MS);
      last = { ok: false, reason: "429", code: 429 };
      continue;
    }
    if (res.code === 503) {
      logWarning("[Status] HTTP 503 → " + (BULK_CFG.WAIT_503_MS / 1000) + "s");
      sleep(BULK_CFG.WAIT_503_MS);
      last = { ok: false, reason: "503", code: 503 };
      continue;
    }
    if (res.code >= 500) {
      sleep(BULK_CFG.WAIT_5XX_MS);
      last = { ok: false, reason: "5xx", code: res.code };
      continue;
    }
    if (res.code < 200 || res.code >= 300) {
      return { ok: false, reason: "http", code: res.code };
    }
    var rawSt = this.xmlTag(res.body, "status");
    return {
      ok: true,
      rawStatus: rawSt,
      status: this.normalizeStatus(rawSt),
      consumedCount: parseInt(this.xmlTag(res.body, "consumedCount"), 10) || 0,
      successfulUpdates: parseInt(this.xmlTag(res.body, "successfulUpdates"), 10) || 0,
      failedUpdates: parseInt(this.xmlTag(res.body, "failedUpdates"), 10) || 0,
      profilesNotFound: parseInt(this.xmlTag(res.body, "profilesNotFound"), 10) || 0
    };
  }
  return last;
};

// # 4. [Write] 적재 컬럼만. 제출 필드(success/httpCode/url)는 다시 써서 공백 방지
BulkStatusChecker.prototype.updateIngest = function(row, ingest) {
  var now = formatDate(new Date(), "%4Y-%2M-%2D %2H:%2N:%2S");
  var dom = new DOMDocument(this.element);
  var root = dom.root;
  root.setAttribute("xtkschema",  this.schema);
  root.setAttribute("_operation", "insertOrUpdate");
  root.setAttribute("_key",       "@batchName");
  root.setAttribute("batchName",  String(row.batchName).substring(0, 100));
  root.setAttribute("workerName", String(row.workerName).substring(0, 20));
  root.setAttribute("runId",      String(row.runId).substring(0, 40));
  root.setAttribute("recordCount", String(row.recordCount));
  root.setAttribute("httpCode",   String(row.httpCode));
  root.setAttribute("success",    String(row.success));
  root.setAttribute("attemptCount", String(row.attemptCount));
  root.setAttribute("elapsedMs",  String(row.elapsedMs));
  root.setAttribute("batchStatusUrl", String(row.url).substring(0, BULK_CFG.LIMIT_URL_LEN));
  root.setAttribute("errorMessage", String(row.errorMessage || "").substring(0, BULK_CFG.ERR_MSG_MAX));
  root.setAttribute("lastModified", now);
  root.setAttribute("batchStatus", ingest.status);
  root.setAttribute("consumedCount", String(ingest.consumedCount || 0));
  root.setAttribute("successfulUpdates", String(ingest.successfulUpdates || 0));
  root.setAttribute("failedUpdates", String(ingest.failedUpdates || 0));
  root.setAttribute("profilesNotFound", String(ingest.profilesNotFound || 0));
  root.setAttribute("statusCheckedDate", now);
  xtk.session.Write(dom);
};

// # 5. [Chunk]
BulkStatusChecker.prototype.runChunk = function() {
  var rows = this.fetchChunk();
  var out = {
    fetched: rows.length, complete: 0, stuck: 0, incomplete: 0, failed: 0,
    consecFail: 0
  };
  var maxFail = parseInt(STATUS_CFG.MAX_CONSEC_FAIL, 10) || 5;
  var stuckH = parseInt(STATUS_CFG.STUCK_AFTER_HOURS, 10) || 24;
  var i;
  for (i = 0; i < rows.length; i++) {
    var row = rows[i];
    var got = this.getStatus(row.url);
    if (!got.ok) {
      out.failed++;
      out.consecFail++;
      logWarning("[Status][FAIL] GET " + row.batchName + " :: " + (got.reason || "")
        + (got.code ? " http=" + got.code : ""));
      if (out.consecFail >= maxFail) {
        logWarning("[Status] 연속 GET 실패 " + out.consecFail + " → 청크 중단, 다음 사이클");
        break;
      }
      continue;
    }
    out.consecFail = 0;
    var st = got.status;
    if (st === "incomplete" && this.ageHours(row.createdDate) >= stuckH) {
      st = "stuck";
      logWarning("[Status] " + row.batchName + " incomplete " + stuckH + "h 초과 → stuck");
    }
    if (got.rawStatus && got.rawStatus !== st && got.rawStatus !== "incomplete") {
      logWarning("[Status] 비공식 status='" + got.rawStatus + "' → " + st
        + " / " + row.batchName);
    }
    try {
      this.updateIngest(row, {
        status: st,
        consumedCount: got.consumedCount,
        successfulUpdates: got.successfulUpdates,
        failedUpdates: got.failedUpdates,
        profilesNotFound: got.profilesNotFound
      });
    } catch (eW) {
      out.failed++;
      logError("[Status][FAIL] Write " + row.batchName + " :: " + (eW.message || eW));
      continue;
    }
    if (st === "complete") out.complete++;
    else if (st === "stuck") out.stuck++;
    else out.incomplete++;
    logInfo("[Status][PASS] " + row.batchName + " status=" + st
      + " consumed=" + got.consumedCount
      + " ok=" + got.successfulUpdates
      + " fail=" + got.failedUpdates
      + (got.rawStatus && got.rawStatus !== st ? " raw=" + got.rawStatus : ""));
  }
  return out;
};
