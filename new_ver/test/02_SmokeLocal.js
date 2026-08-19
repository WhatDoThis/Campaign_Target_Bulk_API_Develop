/* ============================================================================
 * TBAWSmoke / 02_Local
 * 스키마 접근 / Master·Detail I/O / UID 분할 / 페이로드 규격 / 커서 왕복
 * ==========================================================================*/

var PASS  = parseInt(instance.vars.smkPass, 10) || 0;
var FAIL  = parseInt(instance.vars.smkFail, 10) || 0;
var FAILS = String(instance.vars.smkFails || "");
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS += (FAILS ? ", " : "") + n; logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}
function skip(n, w) { logInfo("  [SKIP] " + n + " :: " + w); }

var SCHEMA   = String(instance.vars.smkSchema);
var ELEMENT  = String(instance.vars.smkElement);
var PENDING  = String(instance.vars.smkPending);
var TAG      = String(instance.vars.smkTag);
var UIDP     = String(instance.vars.smkUidPrefix);
var UIDD     = parseInt(instance.vars.smkUidDigits, 10) || 9;
var MASTER   = "wootar:testWooTargetBulkApiMaster";
var DETAIL   = "wootar:testWooTargetBulkApiDetail";

function countOf(schema, cond) {
  var q = "<queryDef schema='" + schema + "' operation='count'>"
        + (cond ? "<where><condition expr=\"" + cond + "\"/></where>" : "")
        + "</queryDef>";
  return parseInt(xtk.queryDef.create(new XML(q)).ExecuteQuery().@count, 10) || 0;
}

/* --- [T2] 스키마 도달성 + 신규 컬럼 물리 반영 확인 ----------------------- */
logInfo("=== T2 Schema Reachability ===");
var memberTotal = -1;
try { memberTotal = countOf(SCHEMA, ""); ok("Member 조회", true, "total=" + memberTotal); }
catch (e) { ok("Member 조회", false, e.toString()); }

try { ok("PendingCond 유효", true, "pending=" + countOf(SCHEMA, PENDING)); }
catch (e) { ok("PendingCond 유효", false, e.toString()); }

try { countOf(MASTER, ""); ok("Master 조회", true); } catch (e) { ok("Master 조회", false, e.toString()); }
try { countOf(DETAIL, ""); ok("Detail 조회", true); } catch (e) { ok("Detail 조회", false, e.toString()); }

// 스키마 저장은 됐는데 DB 구조 업데이트가 안 걸린 케이스를 여기서 잡는다.
try {
  sqlGetInt("SELECT count(*) FROM wootartestwootargetbulkapimaster WHERE iattemptcount IS NULL");
  ok("Master.attemptCount 물리 컬럼", true);
} catch (e) { ok("Master.attemptCount 물리 컬럼", false, "DB 구조 업데이트 필요 / " + e.toString()); }
try {
  sqlGetInt("SELECT count(*) FROM wootartestwootargetbulkapimaster WHERE ielapsedms IS NULL");
  ok("Master.elapsedMs 물리 컬럼", true);
} catch (e) { ok("Master.elapsedMs 물리 컬럼", false, "DB 구조 업데이트 필요 / " + e.toString()); }

/* --- [T3] Master/Detail 쓰기 → 링크 조회 -------------------------------- */
logInfo("=== T3 Schema I/O ===");
if (instance.vars.smkTSchemaIo !== "1") { skip("T3", "스위치 OFF"); }
else {
  try {
    var now = formatDate(new Date(), "%4Y-%2M-%2D %2H:%2N:%2S");
    xtk.session.Write(
      <testWooTargetBulkApiMaster xtkschema={MASTER} _operation="insert"
        batchName={TAG + "-M1"} workerName="SMOKE" recordCount="2"
        httpCode="200" success="1" attemptCount="1" elapsedMs="123"
        batchStatusUrl="http://smoke.local/status" errorMessage=""
        lastModified={now}/>
    );
    var m = xtk.queryDef.create(
      <queryDef schema={MASTER} operation="getIfExists">
        <select><node expr="@id"/><node expr="@createdDate"/>
                <node expr="@success"/><node expr="@elapsedMs"/></select>
        <where><condition expr={"@batchName = '" + TAG + "-M1'"}/></where>
      </queryDef>).ExecuteQuery();

    var masterId = parseInt(m.@id, 10) || 0;
    ok("Master insert + autopk 회수", masterId > 0, "id=" + masterId);
    ok("createdDate 기본값(GetDate)", String(m.@createdDate) !== "", String(m.@createdDate));
    ok("success byte enum", String(m.@success) === "1");
    ok("elapsedMs 저장", String(m.@elapsedMs) === "123", String(m.@elapsedMs));

    if (masterId > 0) {
      // 워커의 saveToDb 와 동일한 컬렉션 구조로 검증
      // xtkschema 는 루트, _operation/_key 는 자식에 붙인다
      var dom = new DOMDocument("testWooTargetBulkApiDetail-collection");
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
          <select><node expr="@membershipUid"/><node expr="[master/@batchName]"/></select>
          <where><condition expr="@membershipUid = 'SMK0000001'"/></where>
        </queryDef>).ExecuteQuery();
      ok("Detail WriteCollection", String(d.@membershipUid) === "SMK0000001");
      ok("Detail→Master 링크", String(d.@batchName) === TAG + "-M1", String(d.@batchName));
    }
  } catch (e) { ok("T3 Schema I/O", false, e.toString()); }
}

/* --- [T4] UID 분할 산술 -------------------------------------------------- */
logInfo("=== T4 Partition ===");
function pad(n) { var s = String(n); while (s.length < UIDD) s = "0" + s; return UIDP + s; }
function uidNum(u) { return parseInt(String(u).substring(UIDP.length), 10) || 0; }
function edgeUid(desc) {
  var r = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select" lineCount="1">
      <select><node expr="@membershipUid"/></select>
      <where><condition expr={PENDING}/></where>
      <orderBy><node expr="@membershipUid" sortDesc={desc}/></orderBy>
    </queryDef>).ExecuteQuery();
  for each (var x in r[ELEMENT]) return String(x.@membershipUid);
  return "";
}

instance.vars.smkMinUid = "";
if (instance.vars.smkTPart !== "1") { skip("T4", "스위치 OFF"); }
else {
  try {
    var minUid = edgeUid("false"), maxUid = edgeUid("true");
    ok("min/max UID 조회", minUid !== "" && maxUid !== "", minUid + " ~ " + maxUid);
    instance.vars.smkMinUid = minUid;

    var lo = uidNum(minUid), hi = uidNum(maxUid), span = hi - lo + 1;
    var per = Math.ceil(span / (parseInt(instance.vars.smkWorkers, 10) || 5));
    var prevEnd = lo - 1, gap = 0, ovl = 0;

    for (var w = 1; w <= (parseInt(instance.vars.smkWorkers, 10) || 5); w++) {
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
  } catch (e) { ok("T4 Partition", false, e.toString()); }
}

/* --- [T5] 페이로드 규격 -------------------------------------------------- */
logInfo("=== T5 Payload Spec ===");
var seg = "w01|w02|w03|w04|w05|w06|w07|w08|w09|w10|w11|w12";
var enc = encodeURIComponent(seg);
var head = "batch=thirdPartyId,seg_id\n";
var row  = "U000000001," + enc + "\n";
var bs   = 5000;
ok("파이프 인코딩", enc.indexOf("%7C") >= 0, enc.substring(0, 24) + "...");
ok("batch= 프리픽스", head.indexOf("batch=") === 0);
ok("배치 50MB 이내", head.length + row.length * bs < 50 * 1024 * 1024,
   ((head.length + row.length * bs) / 1048576).toFixed(2) + "MB @" + bs + "행");
ok("프로필 64KB 이내", row.length < 64 * 1024, row.length + "B/row");

/* --- [T6] apiYn 커서 왕복 ------------------------------------------------ */
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

instance.vars.smkPass  = PASS;
instance.vars.smkFail  = FAIL;
instance.vars.smkFails = FAILS;
logInfo("--- 로컬 검증 누적 PASS=" + PASS + " FAIL=" + FAIL + " ---");
