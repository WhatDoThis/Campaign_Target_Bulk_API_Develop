/* ============================================================================
 * TBAWSmoke / 02_Local (로컬 스키마·분할·라이브러리 dryRun)
 * 스키마 I/O, UID 분할, 페이로드 규격, apiYn 왕복, 같은 캔버스 dryRun.
 *
 * [Main Functions]
 * 1. Member/Master/Detail 도달성 + runId 물리 컬럼
 * 2. Master/Detail 쓰기. 링크는 [@master-id] 와 [master/@id] (같은 조인 키)
 * 3. arith 분할 검증
 * 4. BulkApiWorker dryRun (T_LIB_DRY)
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js, xtk.queryDef, xtk.session, sqlExec
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

var PASS  = parseInt(instance.vars.smkPass, 10) || 0;
var FAIL  = parseInt(instance.vars.smkFail, 10) || 0;
var FAILS = String(instance.vars.smkFails || "");
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS += (FAILS ? ", " : "") + n; logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}
function skip(n, w) { logInfo("  [SKIP] " + n + " :: " + w); }

var SCHEMA  = String(instance.vars.smkSchema);
var ELEMENT = String(instance.vars.smkElement);
var PENDING = String(instance.vars.smkPending);
var TAG     = String(instance.vars.smkTag);
var UIDP    = String(instance.vars.smkUidPrefix);
var UIDD    = parseInt(instance.vars.smkUidDigits, 10) || 9;
var MASTER  = "wootar:testWooTargetBulkApiMaster";
var DETAIL  = "wootar:testWooTargetBulkApiDetail";

function countOf(schema, cond) {
  var q = "<queryDef schema='" + schema + "' operation='count'>"
        + (cond ? "<where><condition expr=\"" + cond + "\"/></where>" : "")
        + "</queryDef>";
  return parseInt(xtk.queryDef.create(new XML(q)).ExecuteQuery().@count, 10) || 0;
}

function pad(n) {
  var s = String(n);
  while (s.length < UIDD) s = "0" + s;
  return UIDP + s;
}

logInfo("=== T2 Schema Reachability ===");
var memberTotal = -1;
try { memberTotal = countOf(SCHEMA, ""); ok("Member 조회", true, "total=" + memberTotal); }
catch (e) { ok("Member 조회", false, e.toString()); }

try { ok("PendingCond 유효", true, "pending=" + countOf(SCHEMA, PENDING)); }
catch (e) { ok("PendingCond 유효", false, e.toString()); }

try { countOf(MASTER, ""); ok("Master 조회", true); } catch (e) { ok("Master 조회", false, e.toString()); }
try { countOf(DETAIL, ""); ok("Detail 조회", true); } catch (e) { ok("Detail 조회", false, e.toString()); }

try {
  sqlGetInt("SELECT count(*) FROM wootartestwootargetbulkapimaster WHERE iattemptcount IS NULL");
  ok("Master.attemptCount 물리 컬럼", true);
} catch (e) { ok("Master.attemptCount 물리 컬럼", false, "DB 구조 업데이트 필요 / " + e.toString()); }
try {
  sqlGetInt("SELECT count(*) FROM wootartestwootargetbulkapimaster WHERE ielapsedms IS NULL");
  ok("Master.elapsedMs 물리 컬럼", true);
} catch (e) { ok("Master.elapsedMs 물리 컬럼", false, "DB 구조 업데이트 필요 / " + e.toString()); }
instance.vars.smkHasRunId = "0";
try {
  sqlGetInt("SELECT count(*) FROM wootartestwootargetbulkapimaster WHERE srunid IS NULL");
  instance.vars.smkHasRunId = "1";
  ok("Master.runId 물리 컬럼", true);
} catch (e) {
  logWarning("  [WARN] Master.runId 미배포. 스키마 게시 후 Tools > Update database structure.");
  logWarning("  이번 스모크는 batchName 으로 회차를 식별한다 / " + e.toString());
}

logInfo("=== T3 Schema I/O ===");
if (instance.vars.smkTSchemaIo !== "1") { skip("T3", "스위치 OFF"); }
else {
  try {
    var now = formatDate(new Date(), "%4Y-%2M-%2D %2H:%2N:%2S");
    var hasRunId = (instance.vars.smkHasRunId === "1");
    if (hasRunId) {
      xtk.session.Write(
        <testWooTargetBulkApiMaster xtkschema={MASTER} _operation="insert"
          batchName={TAG + "-M1"} workerName="SMOKE" runId={String(instance.vars.smkRunId)}
          recordCount="2" httpCode="200" success="1" attemptCount="1" elapsedMs="123"
          batchStatusUrl="http://smoke.local/status" errorMessage=""
          lastModified={now}/>
      );
    } else {
      xtk.session.Write(
        <testWooTargetBulkApiMaster xtkschema={MASTER} _operation="insert"
          batchName={TAG + "-M1"} workerName="SMOKE"
          recordCount="2" httpCode="200" success="1" attemptCount="1" elapsedMs="123"
          batchStatusUrl="http://smoke.local/status" errorMessage=""
          lastModified={now}/>
      );
    }
    var m;
    if (hasRunId) {
      m = xtk.queryDef.create(
        <queryDef schema={MASTER} operation="getIfExists">
          <select>
            <node expr="@id"/><node expr="@createdDate"/>
            <node expr="@success"/><node expr="@elapsedMs"/><node expr="@runId"/>
          </select>
          <where><condition expr={"@batchName = '" + TAG + "-M1'"}/></where>
        </queryDef>).ExecuteQuery();
    } else {
      m = xtk.queryDef.create(
        <queryDef schema={MASTER} operation="getIfExists">
          <select>
            <node expr="@id"/><node expr="@createdDate"/>
            <node expr="@success"/><node expr="@elapsedMs"/>
          </select>
          <where><condition expr={"@batchName = '" + TAG + "-M1'"}/></where>
        </queryDef>).ExecuteQuery();
    }

    var masterId = parseInt(m.@id, 10) || 0;
    ok("Master insert + autopk 회수", masterId > 0, "id=" + masterId);
    ok("createdDate 기본값(GetDate)", String(m.@createdDate) !== "", String(m.@createdDate));
    ok("success byte enum", String(m.@success) === "1");
    ok("elapsedMs 저장", String(m.@elapsedMs) === "123", String(m.@elapsedMs));
    if (hasRunId) {
      ok("runId 저장", String(m.@runId) === String(instance.vars.smkRunId), String(m.@runId));
    } else {
      skip("runId 저장", "스키마/DB 미배포");
    }

    if (masterId > 0) {
      try {
        xtk.session.DeleteCollection(DETAIL,
          <where><condition expr="@membershipUid = 'SMK0000001'"/></where>, false);
      } catch (eDel) {}

      var dom = new DOMDocument("collection");
      dom.root.setAttribute("xtkschema", DETAIL);
      var el = dom.createElement("testWooTargetBulkApiDetail");
      el.setAttribute("_operation",    "insertOrUpdate");
      el.setAttribute("_key",          "@membershipUid");
      el.setAttribute("membershipUid", "SMK0000001");
      el.setAttribute("segId",         "w01|w02|w03");
      el.setAttribute("lastModified",  now);
      el.setAttribute("master-id",     String(masterId));
      dom.root.appendChild(el);
      xtk.session.WriteCollection(dom);

      var d = xtk.queryDef.create(
        <queryDef schema={DETAIL} operation="getIfExists">
          <select>
            <node expr="@membershipUid"/>
            <node expr="[@master-id]" alias="@masterFk"/>
            <node expr="[master/@id]" alias="@masterPk"/>
            <node expr="[master/@batchName]" alias="@masterBatchName"/>
          </select>
          <where><condition expr="@membershipUid = 'SMK0000001'"/></where>
        </queryDef>).ExecuteQuery();
      ok("Detail WriteCollection", String(d.@membershipUid) === "SMK0000001");

      var fkId = parseInt(String(d.@masterFk || ""), 10) || 0;
      var pkId = parseInt(String(d.@masterPk || ""), 10) || 0;
      var linkedName = String(d.@masterBatchName || "");
      var linkOk = (fkId === masterId) || (pkId === masterId)
                || (linkedName === TAG + "-M1");
      var sameKey = (fkId > 0 && pkId > 0) ? (fkId === pkId) : true;
      var dXml = "";
      try { dXml = String(d.toXMLString()).substring(0, 280); } catch (eX) {}
      ok("Detail→Master 링크", linkOk && sameKey,
        "[@master-id]=" + fkId + " [master/@id]=" + pkId
          + " expect=" + masterId + " batchName=" + linkedName
          + (linkOk && sameKey ? "" : " xml=" + dXml));
    }
  } catch (e) { ok("T3 Schema I/O", false, e.toString()); }
}

logInfo("=== T4 Partition ===");
function uidNum(u) { return parseInt(String(u).substring(UIDP.length), 10) || 0; }
function edgeUidSql(agg) {
  var tbl = (typeof BULK_CFG !== "undefined") ? BULK_CFG.MEMBER_TABLE : "WootarTestWooTargetSample";
  return String(sqlGetString(
    "SELECT " + agg + "(smembershipuid) FROM " + tbl
      + " WHERE sapiyn='N' OR sapiyn IS NULL"
  ) || "");
}
function edgeUid(descAsc) {
  var sortDesc = (descAsc === "max") ? "true" : "false";
  var r = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select" lineCount="1">
      <select><node expr="@membershipUid"/></select>
      <where><condition expr={PENDING}/></where>
      <orderBy>
        <node expr="@membershipUid" sortDesc={sortDesc}/>
      </orderBy>
    </queryDef>).ExecuteQuery();
  for each (var x in r[ELEMENT]) return String(x.@membershipUid);
  return "";
}

instance.vars.smkMinUid = "";
if (instance.vars.smkTPart !== "1") { skip("T4", "스위치 OFF"); }
else {
  try {
    var minUid = "", maxUid = "";
    try { minUid = edgeUidSql("min"); maxUid = edgeUidSql("max"); } catch (eSql) {
      logWarning("  min/max SQL 실패 → queryDef 폴백: " + eSql.toString());
      minUid = edgeUid("min");
      maxUid = edgeUid("max");
    }
    ok("min/max UID 조회", minUid !== "" && maxUid !== "", minUid + " ~ " + maxUid);
    instance.vars.smkMinUid = minUid;

    var lo = uidNum(minUid), hi = uidNum(maxUid), span = hi - lo + 1;
    if (span <= 0) {
      ok("UID 구간 산술", false, "span=" + span + " lo=" + lo + " hi=" + hi);
    } else {
      var per = Math.ceil(span / (parseInt(instance.vars.smkWorkers, 10) || 5));
      var prevEnd = lo - 1, gap = 0, ovl = 0;
      var w;

      for (w = 1; w <= (parseInt(instance.vars.smkWorkers, 10) || 5); w++) {
        var s = lo + (w - 1) * per, e2 = Math.min(s + per - 1, hi);
        if (s > hi) { logInfo("  worker" + w + " : 할당 없음"); continue; }
        if (s > prevEnd + 1) gap++;
        if (s <= prevEnd) ovl++;
        prevEnd = e2;
        logInfo("  worker" + w + " : " + pad(s) + " ~ " + pad(e2));
      }
      ok("구간 누락 없음", gap === 0, "gap=" + gap);
      ok("구간 중복 없음", ovl === 0, "overlap=" + ovl);
      ok("마지막 구간이 max 커버", prevEnd === hi, prevEnd + " vs " + hi);
      ok("UID 밀도(arith 적합성)", memberTotal > 0 && (memberTotal / span) > 0.5,
         "density=" + (memberTotal / span).toFixed(3) + " (0.5 미달 시 offset 모드 권장)");
    }
  } catch (e) { ok("T4 Partition", false, e.toString()); }
}

logInfo("=== T5 Payload Spec ===");
var seg = "w01|w02|w03|w04|w05|w06|w07|w08|w09|w10|w11|w12";
var enc = encodeURIComponent(seg);
var extraHead = String(instance.vars.smkCustom || "").replace(/@/g, "").replace(/\s/g, "");
var head = "batch=thirdPartyId,seg_id" + (extraHead ? "," + extraHead : "") + "\n";
var row  = "U000000001," + enc + "\n";
var bs   = 5000;
ok("파이프 인코딩", enc.indexOf("%7C") >= 0, enc.substring(0, 24) + "...");
ok("batch= 프리픽스", head.indexOf("batch=") === 0, head.replace(/\n/g, ""));
ok("배치 50MB 이내", head.length + row.length * bs < 50 * 1024 * 1024,
   ((head.length + row.length * bs) / 1048576).toFixed(2) + "MB @" + bs + "행");

logInfo("=== T6 Cursor ===");
if (instance.vars.smkTCursor !== "1") { skip("T6", "스위치 OFF"); }
else {
  try {
    var vs = [];
    var vr = xtk.queryDef.create(
      <queryDef schema={SCHEMA} operation="select" lineCount="3">
        <select><node expr="@membershipUid"/></select>
        <where><condition expr={PENDING}/></where>
        <orderBy><node expr="@membershipUid" sortDesc="false"/></orderBy>
      </queryDef>).ExecuteQuery();
    for each (var v in vr[ELEMENT]) vs.push(String(v.@membershipUid));

    if (vs.length === 0) { skip("T6", "pending 레코드 없음"); }
    else {
      var ns = SCHEMA.split(":")[0];
      var tbl = ns.substr(0,1).toUpperCase() + ns.substr(1)
              + ELEMENT.substr(0,1).toUpperCase() + ELEMENT.substr(1);
      var inList = "'" + vs.join("','") + "'";
      sqlExec("UPDATE " + tbl + " SET sapiyn='Y' WHERE smembershipuid IN (" + inList + ")");
      ok("sqlExec UPDATE 반영",
         countOf(SCHEMA, "@apiYn = 'Y' AND @membershipUid IN (" + inList + ")") === vs.length);
      sqlExec("UPDATE " + tbl + " SET sapiyn='N' WHERE smembershipuid IN (" + inList + ")");
      ok("원복 완료",
         countOf(SCHEMA, "@apiYn = 'N' AND @membershipUid IN (" + inList + ")") === vs.length);
    }
  } catch (e) { ok("T6 Cursor", false, e.toString() + " ← 물리 테이블/컬럼명 확인"); }
}

logInfo("=== T6b Library dryRun ===");
if (instance.vars.smkTLibDry !== "1") { skip("T6b", "스위치 OFF"); }
else if (typeof BulkApiWorker !== "function") { ok("library dryRun", false, "BulkApiWorker 없음"); }
else {
  try {
    var loUid = String(instance.vars.smkMinUid || "");
    if (!loUid) {
      try { loUid = edgeUidSql("min"); } catch (eLo) { loUid = edgeUid("min"); }
    }
    if (!loUid) { skip("T6b", "pending UID 없음"); }
    else {
      var s0 = uidNum(loUid);
      var lim = parseInt(instance.vars.smkLimit, 10) || 300;
      var wdry = new BulkApiWorker({
        workerName:  "SMOKE-LOCAL",
        uidStart:    pad(s0),
        uidEnd:      pad(s0 + lim - 1),
        runId:       String(instance.vars.smkRunId),
        batchSize:   String(instance.vars.smkBatch),
        dryRun:      "true",
        workerCount: "1",
        customAttr:  String(instance.vars.smkCustom || ""),
        authToken:   ""
      });
      var rd = wdry.run();
      ok("library dryRun 예외 없음", true, "sent=" + rd.sent + " fail=" + rd.failed + " batches=" + rd.batches);
      ok("dryRun은 전송 실패 0", rd.failed === 0, "failed=" + rd.failed);
    }
  } catch (e) { ok("library dryRun", false, e.toString()); }
}

instance.vars.smkPass  = PASS;
instance.vars.smkFail  = FAIL;
instance.vars.smkFails = FAILS;
logInfo("--- 로컬 검증 누적 PASS=" + PASS + " FAIL=" + FAIL + " ---");
