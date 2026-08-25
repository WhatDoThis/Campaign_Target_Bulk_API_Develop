/* ============================================================================
 * TBAWSmoke / 02_Local (로컬 스키마·분할·라이브러리 dryRun)
 * 스키마 I/O, 큐 키(ingestYmd+lineNo) offset 분할, 페이로드 규격, apiYn 왕복, dryRun.
 *
 * [Main Functions]
 * 1. Member/Master 도달성 + 큐 컬럼 + runId 물리 컬럼
 * 2. Master/Sample master FK 링크 검증
 * 3. 같은 ingestYmd(BIZ_DATE) 안 lineNo offset 분할 검증
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

// (변경) FIX-33. %2M 조합이 202608-24 생성 → TIM-030009. 직접 조립으로 회피
function smkTs() {
  var d = getCurrentDate();
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "/" + p2(d.getMonth() + 1) + "/" + p2(d.getDate())
       + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
}

var SCHEMA  = String(instance.vars.smkSchema);
var ELEMENT = String(instance.vars.smkElement);
var PENDING = String(instance.vars.smkPending);
var TAG     = String(instance.vars.smkTag);
var MASTER  = (typeof BULK_CFG !== "undefined") ? String(BULK_CFG.MASTER_SCHEMA) : "wootar:testWooTargetBulkApiMaster";
var MEM_TBL = (typeof BULK_CFG !== "undefined" && BULK_CFG.MEMBER_TABLE)
  ? String(BULK_CFG.MEMBER_TABLE) : "wootartestwootargetsample";

function countOf(schema, cond) {
  var q = "<queryDef schema='" + schema + "' operation='count'>"
        + (cond ? "<where><condition expr=\"" + cond + "\"/></where>" : "")
        + "</queryDef>";
  return parseInt(xtk.queryDef.create(new XML(q)).ExecuteQuery().@count, 10) || 0;
}

function fetchPendingRow(offset) {
  var q = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select"
              startLine={String(offset)} lineCount="1">
      <select>
        <node expr="@membershipUid"/>
        <node expr="@ingestYmd"/>
        <node expr="@lineNo"/>
      </select>
      <where><condition expr={PENDING}/></where>
      <orderBy>
        <node expr="@ingestYmd" sortDesc="false"/>
        <node expr="@lineNo" sortDesc="false"/>
      </orderBy>
    </queryDef>
  ).ExecuteQuery();
  var row = { uid: "", ymd: "", line: 0 };
  for each (var x in q[ELEMENT]) {
    row.uid  = String(x.@membershipUid);
    row.ymd  = String(x.@ingestYmd);
    row.line = parseInt(String(x.@lineNo), 10) || 0;
  }
  return row;
}

logInfo("=== T2 Schema Reachability ===");
try {
  // startLine·orderBy 없이 lineCount=1 만 쓰면 컬렉션이 비는 ACC 빌드 있음
  var probe = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select" startLine="1" lineCount="1">
      <select><node expr="@membershipUid"/></select>
      <orderBy><node expr="@membershipUid" sortDesc="false"/></orderBy>
    </queryDef>).ExecuteQuery();
  var probeUid = "";
  for each (var p in probe[ELEMENT]) probeUid = String(p.@membershipUid);
  ok("Member 조회", probeUid !== "", "uid=" + probeUid);
} catch (e) { ok("Member 조회", false, e.toString()); }

try {
  var qHead = fetchPendingRow(0);
  ok("PendingCond 유효", qHead.uid !== "",
    qHead.uid ? ("uid=" + qHead.uid) : "0건 ← 백필 SQL 후 재실행");
  ok("큐 컬럼 조회(ingestYmd/lineNo)", qHead.ymd.length === 8 && qHead.line >= 1,
    "ymd=" + qHead.ymd + " line=" + qHead.line + " uid=" + qHead.uid
      + (qHead.line >= 1 ? "" : " ← schema/backfillSampleQueue.sql"));
  instance.vars.smkMinYmd  = qHead.ymd;
  instance.vars.smkMinLine = qHead.line;
  instance.vars.smkMinUid  = qHead.uid;
} catch (e) {
  ok("PendingCond 유효", false, e.toString());
  ok("큐 컬럼 조회(ingestYmd/lineNo)", false,
    e.toString() + " ← Sample 스키마 게시 + 백필");
}

try { countOf(MASTER, ""); ok("Master 조회", true); } catch (e) { ok("Master 조회", false, e.toString()); }

try {
  var segProbe = xtk.queryDef.create(
    <queryDef schema={SCHEMA} operation="select" lineCount="1">
      <select><node expr="@segId"/></select>
      <where><condition expr={PENDING}/></where>
    </queryDef>).ExecuteQuery();
  var segVal = "";
  for each (var sp in segProbe[ELEMENT]) segVal = String(sp.@segId || "").replace(/^\s+|\s+$/g, "");
  ok("Sample.segId 사전 적재", segVal !== "", segVal ? segVal.substring(0, 40) : "비어 있음 — sql/02_seed_segid.sql 실행");
} catch (e) { ok("Sample.segId 사전 적재", false, e.toString()); }

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
    // (변경) FIX-33. formatDate %4Y-%2M-%2D 가 TIM-030009 유발 → smkTs 조립
    var now = smkTs();
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
      var linkYmd = String(instance.vars.smkMinYmd || "");
      var linkLine = parseInt(instance.vars.smkMinLine, 10) || 0;
      if (!linkYmd || linkLine < 1) {
        var hq = fetchPendingRow(0);
        linkYmd = hq.ymd;
        linkLine = hq.line;
      }
      if (linkYmd && linkLine >= 1) {
      var prevMaster = 0;
      try {
        var prevQ = xtk.queryDef.create(
          <queryDef schema={SCHEMA} operation="getIfExists">
            <select><node expr="[@master-id]" alias="@masterFk"/></select>
            <where>
              <condition expr={"@ingestYmd='" + linkYmd + "' AND @lineNo=" + linkLine}/>
            </where>
          </queryDef>).ExecuteQuery();
        prevMaster = parseInt(String(prevQ.@masterFk || ""), 10) || 0;
      } catch (ePrev) {}

      sqlExec("UPDATE " + MEM_TBL + " SET imasterid=" + masterId
        + " WHERE singestymd='" + linkYmd + "' AND ilineno=" + linkLine);

      var s = xtk.queryDef.create(
        <queryDef schema={SCHEMA} operation="getIfExists">
          <select>
            <node expr="@membershipUid"/>
            <node expr="[@master-id]" alias="@masterFk"/>
            <node expr="[master/@id]" alias="@masterPk"/>
            <node expr="[master/@batchName]" alias="@masterBatchName"/>
          </select>
          <where>
            <condition expr={"@ingestYmd='" + linkYmd + "' AND @lineNo=" + linkLine}/>
          </where>
        </queryDef>).ExecuteQuery();
      ok("Sample master FK 갱신", String(s.@membershipUid) !== "");

      var fkId = parseInt(String(s.@masterFk || ""), 10) || 0;
      var pkId = parseInt(String(s.@masterPk || ""), 10) || 0;
      var linkedName = String(s.@masterBatchName || "");
      var linkOk = (fkId === masterId) || (pkId === masterId)
                || (linkedName === TAG + "-M1");
      var sameKey = (fkId > 0 && pkId > 0) ? (fkId === pkId) : true;
      ok("Sample→Master 링크", linkOk && sameKey,
        "[@master-id]=" + fkId + " [master/@id]=" + pkId
          + " expect=" + masterId + " batchName=" + linkedName);

      // (변경) FIX-35. 검증 후 원복. 미복원 시 CLEANUP 후 댕글링 FK 잔존
      try {
        sqlExec("UPDATE " + MEM_TBL + " SET imasterid=" + prevMaster
          + " WHERE singestymd='" + linkYmd + "' AND ilineno=" + linkLine);
        logInfo("  [INFO] T3 FK 원복 imasterid=" + prevMaster);
      } catch (eRb) { logWarning("  T3 FK 원복 실패: " + eRb.toString()); }
      } else {
        skip("Sample master FK", "pending 큐 키 없음");
      }
    }
  } catch (e) { ok("T3 Schema I/O", false, e.toString()); }
}

logInfo("=== T4 Partition ===");
if (instance.vars.smkTPart !== "1") { skip("T4", "스위치 OFF"); }
else {
  try {
    var head = fetchPendingRow(0);
    ok("pending 큐 헤드", head.ymd.length === 8 && head.line >= 1,
      head.ymd + " line=" + head.line + " uid=" + head.uid);
    instance.vars.smkMinYmd  = head.ymd;
    instance.vars.smkMinLine = head.line;
    instance.vars.smkMinUid  = head.uid;

    if (head.line < 1) {
      ok("큐 키 백필", false, "lineNo<1 — backfillSampleQueue.sql 실행 후 재시도");
    } else {
      var wCnt = (typeof BULK_CFG !== "undefined")
        ? (parseInt(BULK_CFG.WORKER_COUNT, 10) || 5) : 5;
      var remaining = parseInt(instance.vars.smkLimit, 10) || 300;
      var perOff = Math.ceil(remaining / wCnt);
      var marks = [], mi;
      for (mi = 0; mi < wCnt; mi++) {
        var off = mi * perOff;
        if (off >= remaining) break;
        marks.push(off);
      }
      marks.push(remaining - 1);

      var prevEndLine = 0, ovl = 0, ymdMix = 0, w;
      for (w = 0; w < marks.length - 1; w++) {
        var sRow = fetchPendingRow(marks[w]);
        var endOff = (w === marks.length - 2) ? marks[w + 1] : (marks[w + 1] - 1);
        var eRow = fetchPendingRow(endOff);
        if (sRow.line < 1 || eRow.line < 1) {
          logWarning("  worker" + (w + 1) + " : offset 공백 start=" + marks[w] + " end=" + endOff);
          continue;
        }
        if (sRow.ymd !== head.ymd || eRow.ymd !== head.ymd) ymdMix++;
        if (prevEndLine > 0 && sRow.line <= prevEndLine) ovl++;
        prevEndLine = eRow.line;
        logInfo("  worker" + (w + 1) + " : " + sRow.ymd + " line " + sRow.line + " ~ " + eRow.line
          + " (" + sRow.uid + " ~ " + eRow.uid + ")");
      }
      ok("구간 적재일 단일", ymdMix === 0, "다른 일자 경계=" + ymdMix);
      ok("구간 중복 없음", ovl === 0, "overlap=" + ovl);
      ok("마지막 워커 end line 존재", prevEndLine >= 1, "endLine=" + prevEndLine);
    }
  } catch (e) { ok("T4 Partition", false, e.toString()); }
}

logInfo("=== T5 Payload Spec ===");
var seg = "w01|w02|w03|w04|w05|w06|w07|w08|w09|w10|w11|w12";
var enc = encodeURIComponent(seg);
var extraHead = "";
if (typeof BULK_CFG !== "undefined") {
  extraHead = String(BULK_CFG.CUSTOM_ATTR || "").replace(/@/g, "").replace(/\s/g, "");
}
var head = "batch=thirdPartyId,seg_id" + (extraHead ? "," + extraHead : "") + "\n";
var row  = "U000000001," + enc + "\n";
var bs = (typeof BULK_CFG !== "undefined") ? (parseInt(BULK_CFG.BATCH_SIZE, 10) || 5000) : 5000;
var cap = (typeof BULK_CFG !== "undefined") ? (parseInt(BULK_CFG.LIMIT_FILE_BYTES, 10) || (50 * 1024 * 1024)) : (50 * 1024 * 1024);
ok("파이프 인코딩", enc.indexOf("%7C") >= 0, enc.substring(0, 24) + "...");
ok("batch= 프리픽스", head.indexOf("batch=") === 0, head.replace(/\n/g, ""));
ok("배치 50MB 이내", head.length + row.length * bs < cap,
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
        <orderBy>
          <node expr="@ingestYmd" sortDesc="false"/>
          <node expr="@lineNo" sortDesc="false"/>
        </orderBy>
      </queryDef>).ExecuteQuery();
    for each (var v in vr[ELEMENT]) vs.push(String(v.@membershipUid));

    if (vs.length === 0) { skip("T6", "pending 레코드 없음"); }
    else {
      var tbl = MEM_TBL;
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
    var ymd0 = String(instance.vars.smkMinYmd || instance.vars.smkBizDate || "");
    var ln0 = parseInt(instance.vars.smkMinLine, 10) || 0;
    if (!ymd0 || ln0 < 1) {
      var h2 = fetchPendingRow(0);
      ymd0 = h2.ymd;
      ln0 = h2.line;
    }
    if (!ymd0 || ln0 < 1) { skip("T6b", "pending 큐 키 없음 — 백필 필요"); }
    else {
      var lim = parseInt(instance.vars.smkLimit, 10) || 300;
      var tail = fetchPendingRow(lim - 1);
      var ln1 = (tail.line >= 1 && tail.ymd === ymd0) ? tail.line : (ln0 + lim - 1);
      var wdry = new BulkApiWorker({
        workerName:  "SMOKE-LOCAL",
        ingestYmd:   ymd0,
        bizDate:     String(instance.vars.smkBizDate || ymd0),
        lineStart:   String(ln0),
        lineEnd:     String(ln1),
        runId:       String(instance.vars.smkRunId),
        dryRun:      "true",
        workerCount: "1"
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
