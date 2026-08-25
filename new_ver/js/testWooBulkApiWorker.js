// ============================================================
// wootar:testWooBulkApiWorker.js (Target Bulk Profile 전송 워커)
// ------------------------------------------------------------
// Adobe Target Bulk Profile Update API v2. 워커 WF N개(최대 15)가 loadLibrary로 공유.
// 기본 전송은 thirdPartyId + seg_id. CUSTOM_ATTR로 샘플 스키마 속성을 가변 추가.
// segId는 Sample 컬럼 사전 적재. 전송 이력은 Sample.apiYn + master FK.
// 인스턴스 상태는 this. 스로틀은 BulkApiWorker.calcThrottleMs(workerCount).
//
// [Main Functions]
// 1. queryMembers — apiYn='N' + ingestYmd(=BIZ_DATE) + lineNo 커서 + @segId. idx_pending_queue 조건 일치
// 2. buildPayload — batch=thirdPartyId,seg_id[,attr...]. 값은 URL-encode
// 3. sendSlice — 50MB 초과 분할 + POST + Master + Sample UPDATE
// 4. callBulkApiPayload — POST v2 + 스로틀 + 429/503 재시도
// 5. saveMaster / updateSampleSent — Master 1건 + Sample 구간 sqlExec UPDATE
// 6. parseCustomAttrs — "@planName, @phoneNumber" 또는 JSON 유사 배열
// 7. resolveBizDate — BIZ_DATE 해석(빈값=오늘, YYYYMMDD hardcode)
//
// [Dependencies]
// xtk.queryDef, xtk.session, HttpClientRequest, MemoryBuffer, sqlExec, sqlSelect
// [참조] https://experienceleague.adobe.com/en/docs/target-dev/developer/api/profile-apis/profile-bulk-api
//        https://experienceleague.adobe.com/en/docs/target-dev/developer/implementation/methods/profile-api-settings
//        https://experienceleague.adobe.com/en/docs/target/using/troubleshoot/target-limits
// ============================================================


// ============================================================
// 환경 설정 — BULK_CFG 에 운영 파라미터 일원화
//   BULK_ 접두어: loadLibrary는 호출부와 동일 스코프에 로드됨.
//                 CFG 같은 흔한 이름은 워크플로우 변수와 충돌 위험
//   xtk:option(getOption/setOption)은 쓰지 않음. 값은 여기 또는 시그널(vars)
// ============================================================
var BULK_CFG = {

    // ---- Target 연동 ----
    //   둘 다 Administration > Implementation 같은 페이지. 구역이 다름
    CLIENT_CODE : "ibankapacpartnersand",   // Account Details 의 Client Code
    // HttpClientRequest 는 serverConf.xml urlPermission 허용 목록만 호출한다.
    //   dnsSuffix="tt.omtrdc.net" 없으면 JST-310026. 변경 후 nlserver 재시작
    //   POST batchUpdate 와 GET batchStatus(mboxedge) 모두 해당
    // AUTH_TOKEN = Profile API 구역 토큰.
    //   1) Profile API > Require Authentication 을 ON
    //   2) Generate New Profile Authentication Token
    //   3) 헤더 Authorization: Bearer {이 값}
    //   OFF면 비움 (헤더 생략). 재발급 시 이전 값으로 호출하면 실패
    //   공식: /docs/target-dev/developer/implementation/methods/profile-api-settings
    AUTH_TOKEN  : "",


    // ---- 처리 규모 ----
    // BATCH_SIZE: queryMembers 1회 fetch 상한. 50MB·500k 이내, nlserver 메모리 피크 고려 — target-limits
    BATCH_SIZE        : 50000,
    MAX_BATCH_ROWS      : 500000,           // profile-bulk-api 공식 행 상한 (하드 가드)
    LINE_NO_MAX         : 2000000000,       // lineNo 가드. ACC long 최대보다 여유. wrap 금지


    // ---- 적재 기준일 (Factory·워커 pending 스코프) ----
    // BIZ_DATE: 오늘(또는 지정일) ingestYmd 와 일치하는 Sample 행만 전송 대상.
    //   포맷: YYYYMMDD — 8자리 숫자 (예: 20260824). 하이픈·월만(202608) 금지.
    //   "" (빈값): 실행 시점 오늘 → formatDate(new Date(), "%4Y%2M%2D")
    //   "20260824": hardcode — 재전송·보정·과거일 배치 시 BULK_CFG 또는 시그널 bizDate
    // Factory 00_Config / 시그널 bizDate 가 BULK_CFG 보다 우선(워커 생성자 p.bizDate)
    BIZ_DATE            : "",


    // ---- 추가 프로필 속성 (Target profile.{name}) ----
    //   기본 전송: thirdPartyId + seg_id (seg_id ← Sample.segId 사전 적재)
    //   비어 있으면 추가 컬럼 없음
    //   예: "@planName, @phoneNumber"  또는  '["@planName","@phoneNumber"]'
    //   시그널 customAttr > 여기 값
    CUSTOM_ATTR         : "@planName",
    EXTRA_VAL_MAX       : 256,              // target-limits 속성값 256 chars


    // ---- 대상 스키마 (Sample = 전송 큐) ----
    MEMBER_SCHEMA       : "wootar:testWooTargetSample",
    MEMBER_ELEMENT      : "testWooTargetSample",
    MEMBER_TABLE        : "wootartestwootargetsample",   // sqlExec UPDATE 용 물리 테이블(PG 소문자)


    // ---- 전송 이력 Master (배치 1건 = POST 1회) ----
    MASTER_SCHEMA       : "wootar:testWooTargetBulkApiMaster",
    MASTER_ELEMENT      : "testWooTargetBulkApiMaster",

    // segId 전송 길이 상한. Sample.segId 컬럼 length=255 와 동일
    SEG_MAX_LEN         : 255,


    // ---- 재시도 / 대기 (sleep 단위 = milliseconds, ACC 공식) ----
    MAX_RETRY           : 3,
    WAIT_429_MS         : 10000,            // 프록시/APIM 레이트 리밋
    WAIT_503_MS         : 65000,            // Target 계정 한도 초과. 한도 창이 분 단위라 65초
    WAIT_5XX_MS         : 5000,             // 그 외 서버 오류 (500/502/504)
    MAX_ERROR           : 3,                // 연속 배치 실패 허용 횟수
    ERR_MSG_MAX         : 2000,             // Master.errorMessage memo 상한


    // ---- 레이트 리밋 방어 ----
    //   Target 한도: bulk profile update API 50 calls/min, 계정 전체 공유
    //   초과 시 429 아닌 503 반환
    //   STATUS_CPM: testWooBulkApiStatus.js 가 동시 실행 시 쓸 예산. 워커는 나머지 45 분할
    ACCOUNT_CPM         : 50,
    STATUS_CPM          : 5,
    WORKER_COUNT        : 3,                // Factory 발사 + 스로틀 기본
    WORKER_MAX          : 15,
    SAFETY_RATIO        : 0.9,              // (ACCOUNT_CPM - STATUS_CPM) 예산 중 워커에 할당할 비율
    STAGGER_SLOT_MS     : 1200,             // 워커 첫 POST 분산. TBAW1=0, TBAW2=1.2s ...

    // 50MB 초과 시 throw 대신 절반 분할 재귀. BATCH_SIZE 를 크게 쓰기 위한 필수 장치
    SPLIT_ON_OVERSIZE   : true,


    // ---- Target 규격 상한 ----
    LIMIT_FILE_BYTES    : 50 * 1024 * 1024, // profile-bulk-api 배치 파일 크기
    LIMIT_URL_LEN       : 255               // Master.batchStatusUrl 컬럼 길이
  };


// ============================================================
// 생성자
//   p = 시그널 파라미터(vars)
//   필수: workerName, lineStart, lineEnd
//   ingestYmd: Factory가 head 적재일 주입. 생략 시 BIZ_DATE(오늘 또는 BULK_CFG.BIZ_DATE)
//   bizDate: 시그널로 BIZ_DATE override (재전송). 생략 시 BULK_CFG.BIZ_DATE → 오늘
//   Factory 시그널: runId, workerCount(실발사). batchSize/dryRun/authToken/customAttr 없음
//   스모크만 선택: batchSize, dryRun, authToken, customAttr
// ============================================================
function BulkApiWorker(p) {
  p = p || {};

  this.workerName = String(p.workerName || "W0");
  this.bizDate    = BulkApiWorker.resolveBizDate(p.bizDate);
  this.ingestYmd  = BulkApiWorker.resolveIngestYmd(p, this.bizDate);
  this.lineStart  = parseInt(p.lineStart, 10);
  this.lineEnd    = parseInt(p.lineEnd, 10);

  // runId: 회차 식별자. Distributor가 전 워커에 동일값 주입 시 회차 단위 조회 가능
  this.runId = String(p.runId || formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S"));

  this.BATCH_SIZE = parseInt(p.batchSize, 10) || BULK_CFG.BATCH_SIZE;

  // DRY_RUN: API 전송 + Sample 갱신만 생략. 조회/CSV조립/Master(드라이)는 수행
  this.DRY_RUN = (String(p.dryRun || "") === "true");

  // 실제 HTTP POST 횟수. sendSlice 분할 시 fetch 횟수와 다를 수 있음
  this.postNo = 0;

  this.bulkApiUrl = "https://" + BULK_CFG.CLIENT_CODE
    + ".tt.omtrdc.net/m2/" + BULK_CFG.CLIENT_CODE + "/v2/profile/batchUpdate";

  // 토큰: 시그널 authToken > BULK_CFG.AUTH_TOKEN (Profile API 토큰). 둘 다 비면 헤더 생략
  this.authToken = this.resolveAuthToken(p);

  // 추가 속성: 시그널 customAttr > BULK_CFG.CUSTOM_ATTR
  this.customAttrs = this.parseCustomAttrs(this.resolveCustomAttrRaw(p));

  if (!/^[0-9]{8}$/.test(this.ingestYmd)) {
    throw new Error("[" + this.workerName + "] ingestYmd 미주입 또는 YYYYMMDD 아님: " + this.ingestYmd);
  }
  if (this.ingestYmd !== this.bizDate) {
    throw new Error("[" + this.workerName + "] ingestYmd(" + this.ingestYmd
      + ") != BIZ_DATE(" + this.bizDate + ")");
  }
  if (!(this.lineStart >= 1) || !(this.lineEnd >= this.lineStart)) {
    throw new Error("[" + this.workerName + "] lineStart/lineEnd 구간 오류: "
      + this.lineStart + " ~ " + this.lineEnd);
  }
  var lineMax = parseInt(BULK_CFG.LINE_NO_MAX, 10) || 2000000000;
  if (this.lineEnd > lineMax) {
    throw new Error("[" + this.workerName + "] lineEnd " + this.lineEnd
      + " > LINE_NO_MAX " + lineMax);
  }
  if (this.BATCH_SIZE > BULK_CFG.MAX_BATCH_ROWS) {
    throw new Error("[" + this.workerName + "] BATCH_SIZE " + this.BATCH_SIZE
      + " > Target 상한 " + BULK_CFG.MAX_BATCH_ROWS);
  }

  // 스로틀 = 60초 / ((ACCOUNT_CPM - STATUS_CPM) × SAFETY_RATIO / 워커수)
  // 워커 3·SAFETY_RATIO 0.9 기준 약 4,445ms — target-limits 50 calls/min
  var workerCount = parseInt(p.workerCount, 10) || BULK_CFG.WORKER_COUNT;
  if (workerCount < 1) workerCount = 1;
  var wmax = parseInt(BULK_CFG.WORKER_MAX, 10) || 15;
  if (workerCount > wmax) {
    logWarning("[" + this.workerName + "] workerCount " + workerCount
      + " > WORKER_MAX " + wmax + " → 스로틀을 " + wmax + " 기준으로 계산");
    workerCount = wmax;
  }
  this.workerCount = workerCount;
  this.workerIndex = 0;
  var nm = String(this.workerName || "").match(/([0-9]+)$/);
  if (nm) this.workerIndex = parseInt(nm[1], 10) || 0;

  this.MIN_INTERVAL_MS = BulkApiWorker.calcThrottleMs(workerCount);   // Factory 00_Config 와 동일 공식

  this.lastCallMs = 0;    // 직전 API 호출 시각. 0 = 미호출
  this.lastAttempt = 0;   // 직전 배치의 실제 시도 횟수. 실패 Master 기록용
}


// 워커·Factory Config 공용 스로틀(ms). (ACCOUNT_CPM - STATUS_CPM) × SAFETY_RATIO / workerCount
// target-limits: bulk profile update 50 calls/min, 초과 시 503
BulkApiWorker.calcThrottleMs = function(workerCount) {
  var wc = parseInt(workerCount, 10) || 1;
  if (wc < 1) wc = 1;
  var budget = parseInt(BULK_CFG.ACCOUNT_CPM, 10) - parseInt(BULK_CFG.STATUS_CPM, 10);
  if (!(budget > 0)) budget = 1;
  var cpm = (budget * BULK_CFG.SAFETY_RATIO) / wc;
  // 설정 오타로 0 이 되면 60000/0 → Infinity → sleep 무한 대기
  if (!(cpm > 0)) cpm = 1;
  return Math.ceil(60000 / cpm);
};


// # 7. resolveBizDate — BIZ_DATE 해석. Factory·워커 공용
//   override(시그널 bizDate) > BULK_CFG.BIZ_DATE > 오늘(%4Y%2M%2D)
BulkApiWorker.resolveBizDate = function(override) {
  var o = String(override === undefined || override === null ? "" : override)
    .replace(/^\s+|\s+$/g, "");
  if (o) {
    if (!/^[0-9]{8}$/.test(o)) {
      throw new Error("[BulkApiWorker] bizDate 형식 오류(YYYYMMDD 8자리): " + o);
    }
    return o;
  }
  var cfg = String(BULK_CFG.BIZ_DATE || "").replace(/^\s+|\s+$/g, "");
  if (cfg) {
    if (!/^[0-9]{8}$/.test(cfg)) {
      throw new Error("[BulkApiWorker] BULK_CFG.BIZ_DATE 형식 오류(YYYYMMDD 8자리): " + cfg);
    }
    return cfg;
  }
  return formatDate(new Date(), "%4Y%2M%2D");
};


// ingestYmd: 시그널 ingestYmd > BIZ_DATE. Factory는 head와 동일값 주입
BulkApiWorker.resolveIngestYmd = function(p, bizDate) {
  p = p || {};
  var raw = String(p.ingestYmd || "").replace(/^\s+|\s+$/g, "");
  if (!raw) {
    return bizDate;
  }
  return raw;
};


// --- 인증 토큰 해석. 값은 로그에 남기지 않음 ---
BulkApiWorker.prototype.resolveAuthToken = function(p) {
  var t = String((p && p.authToken) || "").replace(/^\s+|\s+$/g, "");
  if (t) return t;
  return String(BULK_CFG.AUTH_TOKEN || "").replace(/^\s+|\s+$/g, "");
};


// --- CUSTOM_ATTR 원문. 값은 속성명만, 고객 데이터 아님 ---
BulkApiWorker.prototype.resolveCustomAttrRaw = function(p) {
  var t = String((p && p.customAttr) || "").replace(/^\s+|\s+$/g, "");
  if (t) return t;
  return String(BULK_CFG.CUSTOM_ATTR || "").replace(/^\s+|\s+$/g, "");
};


// ============================================================
// CUSTOM_ATTR 파싱
//   허용: "@planName, @phoneNumber"
//         '["@planName","@phoneNumber"]'
//         "planName,phoneNumber"
//   헤더명은 스키마 속성명 그대로 (Target은 대소문자 구분 → profile.planName)
//   예약(membershipUid, apiYn, seg_id, segId, thirdPartyId, ingestYmd, lineNo)은 제외
// ============================================================
BulkApiWorker.prototype.parseCustomAttrs = function(raw) {
  var s = String(raw === undefined || raw === null ? "" : raw).replace(/^\s+|\s+$/g, "");
  if (!s) return [];

  if (s.charAt(0) === "[") {
    s = s.substring(1);
  }
  if (s.charAt(s.length - 1) === "]") {
    s = s.substring(0, s.length - 1);
  }

  var parts = s.split(",");
  var out = [];
  var seen = {};
  var i;

  for (i = 0; i < parts.length; i++) {
    var n = parts[i].replace(/^\s+|\s+$/g, "");
    if (n.charAt(0) === "\"" || n.charAt(0) === "'") {
      n = n.substring(1);
    }
    if (n.charAt(n.length - 1) === "\"" || n.charAt(n.length - 1) === "'") {
      n = n.substring(0, n.length - 1);
    }
    n = n.replace(/^\s+|\s+$/g, "");
    if (n.charAt(0) === "@") {
      n = n.substring(1);
    }
    if (!n) continue;

    // queryDef expr에 넣을 이름이므로 식별자만 허용
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) {
      throw new Error("[" + this.workerName + "] CUSTOM_ATTR 잘못된 속성명: " + n);
    }

    var key = n.toLowerCase();
    if (key === "membershipuid" || key === "apiyn" || key === "segid"
        || key === "seg_id" || key === "thirdpartyid"
        || key === "ingestym" || key === "ingestymd" || key === "lineno") {
      logWarning("[" + this.workerName + "] CUSTOM_ATTR 예약 컬럼 제외: @" + n);
      continue;
    }
    if (seen[key]) continue;
    seen[key] = 1;
    out.push(n);
  }

  return out;
};


// --- E4X 속성 동적 읽기. 없거나 빈 값은 "" (공식: 빈 값은 기존 프로필을 지우지 않음) ---
BulkApiWorker.prototype.readXmlAttr = function(el, name) {
  try {
    var v = el.attribute(name);
    if (v === undefined || v === null) return "";
    return String(v);
  } catch (e) {
    return "";
  }
};


// --- 추가 속성값 길이 상한 ---
BulkApiWorker.prototype.clipExtra = function(val) {
  var s = String(val === undefined || val === null ? "" : val);
  if (s.length > BULK_CFG.EXTRA_VAL_MAX) {
    return s.substring(0, BULK_CFG.EXTRA_VAL_MAX);
  }
  return s;
};


// --- ACC 예외 문구. JST-310026 등은 message 가 비어 있고 toString 에만 있음 ---
BulkApiWorker.prototype.errText = function(e) {
  if (e === undefined || e === null) return "";
  var m = "";
  try { m = String(e.message || ""); } catch (x) { m = ""; }
  if (m && m !== "undefined") return m;
  return String(e);
};


// --- Profile API 인증이 켜진 환경만 Bearer 부여 ---
BulkApiWorker.prototype.applyAuth = function(req) {
  if (this.authToken) {
    req.header["Authorization"] = "Bearer " + this.authToken;
  }
};


// --- SQL/XTK 문자열 리터럴. ' → '' 만 처리 (ACC JS, lookbehind 없음) ---
BulkApiWorker.prototype.sqlLit = function(s) {
  return String(s === undefined || s === null ? "" : s).replace(/'/g, "''");
};


// --- XML 태그 1개 추출. 정규 파서 없이 indexOf (SpiderMonkey) ---
BulkApiWorker.prototype.xmlTag = function(body, tag) {
  var raw = String(body || "");
  var open = "<" + tag + ">";
  var start = raw.indexOf(open);
  var end = raw.indexOf("</" + tag + ">");
  if (start < 0 || end <= start) return "";
  return raw.substring(start + open.length, end);
};


// --- URL 인코딩. 파이프/쉼표 등 CSV 파괴 문자 방어 ---
BulkApiWorker.prototype.urlEncode = function(str) {
  if (str === undefined || str === null) return "";
  return encodeURIComponent(String(str));
};


// --- segId 길이 상한. Sample.segId / Target seg_id 공통 ---
BulkApiWorker.prototype.clipSegId = function(seg) {
  var s = String(seg === undefined || seg === null ? "" : seg);
  if (s.length > BULK_CFG.SEG_MAX_LEN) {
    return s.substring(0, BULK_CFG.SEG_MAX_LEN);
  }
  return s;
};


// ============================================================
// # 1. queryMembers — ingestYmd(=BIZ_DATE) + lineNo 범위 + 커서 페이징
//   첫 호출: lineStart 이상 / 이후: 직전 배치 마지막 lineNo 초과
//   orderBy @lineNo ASC. CSV 행 순서 = 적재 일련
//
//   [주의] @apiYn = 'N' — idx_pending_queue(apiYn,ingestYmd,lineNo) 와 조건 순서 일치
//          @ingestYmd = BIZ_DATE — 다른 적재일 행은 조회하지 않음
//          apiYn NULL 행은 처리 대상 아님. notNull + sqlDefault='N' 전제
//   [주의] @segId 는 Sample 사전 적재. 비어 있으면 run()에서 throw
//   [주의] distinct 미사용 — 같은 UID가 여러 큐 행일 수 있음. 구간은 lineNo
// ============================================================
BulkApiWorker.prototype.queryMembers = function(lastLine, fetchSize) {

  var lo = (lastLine > 0) ? lastLine : this.lineStart;
  var op = (lastLine > 0) ? ">" : ">=";
  var condition = "@apiYn = 'N'"
    + " AND @ingestYmd = '" + this.sqlLit(this.ingestYmd) + "'"
    + " AND @lineNo " + op + " " + lo
    + " AND @lineNo <= " + this.lineEnd;

  var extraNodes = new XMLList();
  var ci;
  for (ci = 0; ci < this.customAttrs.length; ci++) {
    extraNodes += <node expr={"@" + this.customAttrs[ci]}/>;
  }

  var query = xtk.queryDef.create(
    <queryDef schema={BULK_CFG.MEMBER_SCHEMA} operation="select"
              lineCount={String(fetchSize)}>
      <select>
        <node expr="@membershipUid"/>
        <node expr="@lineNo"/>
        <node expr="@segId"/>
        {extraNodes}
      </select>
      <where>
        <condition expr={condition}/>
      </where>
      <orderBy>
        <node expr="@lineNo" sortDesc="false"/>
      </orderBy>
    </queryDef>
  );

  return query.ExecuteQuery();
};


// ============================================================
// # 2. buildPayload — CSV 페이로드 조립
//   기본: "batch=thirdPartyId,seg_id" + UID,segId
//   CUSTOM_ATTR 있으면 헤더·행에 컬럼 추가 → Target profile.{name}
//   segId: Sample.segId (파이프 구분). URL-encode 필수 (%7C)
//   공식: 파라미터와 값은 UTF-8 URL-encode. 빈 칸은 기존 값을 지우지 않음
//   배열 + join 사용 — 문자열 += 누적은 SpiderMonkey에서 O(n²)
//   50MB 검사·분할은 sendSlice() 가 담당 (여기서 throw 하지 않음)
// ============================================================
BulkApiWorker.prototype.buildPayload = function(batchRecords) {
  var headers = ["thirdPartyId", "seg_id"];
  var i, j;
  for (i = 0; i < this.customAttrs.length; i++) {
    headers.push(this.customAttrs[i]);
  }
  var rows = ["batch=" + headers.join(",")];

  for (i = 0; i < batchRecords.length; i++) {
    var cols = [
      this.urlEncode(batchRecords[i].uid),
      this.urlEncode(this.clipSegId(batchRecords[i].segId))
    ];
    var extras = batchRecords[i].extras || {};
    for (j = 0; j < this.customAttrs.length; j++) {
      cols.push(this.urlEncode(this.clipExtra(extras[this.customAttrs[j]])));
    }
    rows.push(cols.join(","));
  }

  return rows.join("\n");
};


// ============================================================
// 호출 간격 스로틀
//   직전 호출로부터 MIN_INTERVAL_MS 미경과 시 잔여 시간만큼 대기
//   Sample UPDATE 가 간격보다 오래 걸리면 no-op → 느린 구간엔 부하 없음
//   재시도 포함 매 HTTP 호출 직전 적용. batchStatus GET 은 status 라이브러리
//   첫 호출: 워커 번호 × STAGGER_SLOT_MS. 동시 기동 시 POST 폭주 방지
// ============================================================
BulkApiWorker.prototype.throttle = function() {
  var now = new Date().getTime();

  if (this.MIN_INTERVAL_MS <= 0) {
    this.lastCallMs = now;
    return 0;
  }

  if (this.lastCallMs === 0) {
    var slot = parseInt(BULK_CFG.STAGGER_SLOT_MS, 10) || 1200;
    var idx  = this.workerIndex || 0;
    var wait = (idx > 1) ? ((idx - 1) * slot) : 0;
    if (wait > 0) {
      logInfo("[" + this.workerName + "] 첫 호출 분산 " + wait + "ms (워커#" + idx + ")");
      sleep(wait);
    }
    this.lastCallMs = new Date().getTime();
    return wait;
  }

  var gap = now - this.lastCallMs;
  var wait2 = 0;

  if (gap < this.MIN_INTERVAL_MS) {
    wait2 = this.MIN_INTERVAL_MS - gap;
    logInfo("[" + this.workerName + "] 스로틀 " + wait2 + "ms 대기");
    sleep(wait2);
  }

  this.lastCallMs = new Date().getTime();
  return wait2;
};


// ============================================================
// # 3. callBulkApiPayload — Bulk API POST (payload 사전 조립)
//   1단계 HTTP: 429/503/5xx = 대기 후 재시도, 4xx = 즉시 실패
//   2단계 비즈니스: HTTP 200 + <success>false</success> 가능
//
//   MemoryBuffer 루프 밖 1회 생성 — body 재대입 시 재시도 재사용 안전
//          https://experienceleague.adobe.com/developer/campaign-api/api/p-HttpClientRequest-body.html
// ============================================================
BulkApiWorker.prototype.callBulkApiPayload = function(payload, rowCount) {

  // DRY_RUN: 전송만 생략. 반환 계약은 실전송과 동일 키 유지
  if (this.DRY_RUN) {
    var headerEnd = payload.indexOf("\n");
    var headerLine = (headerEnd > 0) ? payload.substring(0, headerEnd) : payload;
    logInfo("[" + this.workerName + "][DRY_RUN] 전송 생략 rows=" + rowCount
      + " bytes=" + payload.length
      + " / " + headerLine);
    this.lastAttempt = 1;
    return { code: 200, success: true, batchStatus: "DRYRUN", attempt: 1, elapsedMs: 0 };
  }

  var buffer = new MemoryBuffer();
  buffer.fromString(payload, "utf-8");

  var req, code = 0, responseBody = "", attempt = 0;
  var netMs = 0;   // 순수 HTTP 왕복 누적. 스로틀/백오프 대기 제외

  for (attempt = 1; attempt <= BULK_CFG.MAX_RETRY; attempt++) {

    this.lastAttempt = attempt;
    this.throttle();   // 계정 한도 방어. 재시도 포함 매 호출 적용

    var t0 = new Date().getTime();

    req = new HttpClientRequest(this.bulkApiUrl);
    req.method = "POST";
    req.header["Content-Type"] = "application/x-www-form-urlencoded";
    this.applyAuth(req);
    req.body = buffer;
    req.execute();

    netMs += new Date().getTime() - t0;

    code = req.response.code;
    responseBody = String(req.response.body);

    // 429: 프록시/APIM 레이트 리밋
    if (code === 429) {
      logWarning("[" + this.workerName + "] HTTP 429 Rate Limited → "
        + (BULK_CFG.WAIT_429_MS / 1000) + "s 대기 (" + attempt + "/" + BULK_CFG.MAX_RETRY + ")");
      sleep(BULK_CFG.WAIT_429_MS);
      continue;
    }

    // 503: Target 계정 한도(50 calls/min) 초과
    if (code === 503) {
      logWarning("[" + this.workerName + "] HTTP 503 Target 분당 한도 초과 → "
        + (BULK_CFG.WAIT_503_MS / 1000) + "s 대기 (" + attempt + "/" + BULK_CFG.MAX_RETRY + ")");
      sleep(BULK_CFG.WAIT_503_MS);
      continue;
    }

    // 500 / 502 / 504: 일시적 서버 오류
    if (code >= 500) {
      logWarning("[" + this.workerName + "] HTTP " + code + " 서버에러 → "
        + (BULK_CFG.WAIT_5XX_MS / 1000) + "s 대기 (" + attempt + "/" + BULK_CFG.MAX_RETRY + ")");
      sleep(BULK_CFG.WAIT_5XX_MS);
      continue;
    }

    // 4xx: 요청 자체 오류. 재시도 무의미
    if (code >= 400) {
      throw new Error("[" + this.workerName + "] HTTP " + code
        + " 클라이언트에러 / " + responseBody.substring(0, 500));
    }

    break;   // 2xx
  }

  if (code === 429 || code >= 500) {
    throw new Error("[" + this.workerName + "] " + BULK_CFG.MAX_RETRY
      + "회 재시도 초과 (마지막 HTTP " + code + ")");
  }

  // 비즈니스 판정
  if (responseBody.indexOf("<success>true</success>") < 0) {
    throw new Error("[" + this.workerName + "] Bulk API 비즈니스 실패 (HTTP " + code
      + ") / " + responseBody.substring(0, 500));
  }

  // batchStatus URL 추출. 적재 GET은 wootar:testWooBulkApiStatus.js
  var batchStatus = this.xmlTag(responseBody, "batchStatus");

  return {
    code:        code,
    success:     true,
    batchStatus: batchStatus,
    attempt:     attempt,
    elapsedMs:   netMs
  };
};


// ============================================================
// # 4. saveMaster — 배치 1건. 성공/실패 공통
//   insertOrUpdate + _key=@batchName → 동일 batchName 재실행 시 최종 상태만 잔존
//   Write는 반환값 없음 → autopk는 batchName으로 재조회
//   적재 컬럼(batchStatus 등)은 status 잡이 채움. ingestChecked=true 일 때만 기록
// ============================================================
// (변경) FIX-33. %2M 조합이 202608-24 생성 → TIM-030009. 직접 조립으로 회피
function bulkTs() {
  var d = getCurrentDate();
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "/" + p2(d.getMonth() + 1) + "/" + p2(d.getDate())
       + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
}

BulkApiWorker.prototype.saveMaster = function(info) {
  // (변경) FIX-33. formatDate %4Y-%2M-%2D 가 TIM-030009 유발 → bulkTs 조립
  var now = bulkTs();

  var insertDOM = new DOMDocument(BULK_CFG.MASTER_ELEMENT);
  var root = insertDOM.root;
  root.setAttribute("xtkschema",      BULK_CFG.MASTER_SCHEMA);
  root.setAttribute("_operation",     "insertOrUpdate");
  root.setAttribute("_key",           "@batchName");
  root.setAttribute("batchName",      String(info.batchName || "").substring(0, 100));
  root.setAttribute("workerName",     String(info.workerName || "").substring(0, 20));
  root.setAttribute("runId",          String(this.runId || "").substring(0, 40));
  root.setAttribute("recordCount",    String(info.recordCount || 0));
  root.setAttribute("httpCode",       String(info.httpCode || 0));
  root.setAttribute("success",        info.success ? "1" : "0");
  root.setAttribute("attemptCount",   String(info.attemptCount || 0));
  root.setAttribute("elapsedMs",      String(info.elapsedMs || 0));
  root.setAttribute("lastModified",   now);
  root.setAttribute("batchStatusUrl",
    String(info.batchStatusUrl || "").substring(0, BULK_CFG.LIMIT_URL_LEN));
  root.setAttribute("errorMessage",
    String(info.errorMessage || "").substring(0, BULK_CFG.ERR_MSG_MAX));

  if (info.ingestChecked) {
    var st = String(info.ingestStatus || "");
    if (st === "complete" || st === "incomplete" || st === "stuck") {
      root.setAttribute("batchStatus", st);
    }
    root.setAttribute("consumedCount",     String(info.consumedCount || 0));
    root.setAttribute("successfulUpdates", String(info.successfulUpdates || 0));
    root.setAttribute("failedUpdates",     String(info.failedUpdates || 0));
    root.setAttribute("profilesNotFound",  String(info.profilesNotFound || 0));
    root.setAttribute("statusCheckedDate", now);
  }

  xtk.session.Write(insertDOM);

  var result = xtk.queryDef.create(
    <queryDef schema={BULK_CFG.MASTER_SCHEMA} operation="get">
      <select>
        <node expr="@id"/>
      </select>
      <where>
        <condition expr={"@batchName='" + this.sqlLit(info.batchName) + "'"}/>
      </where>
    </queryDef>
  ).ExecuteQuery();

  return parseInt(result.@id, 10) || 0;   // 0 = id 미확보
};


// ============================================================
// # 5. updateSampleSent — 성공 배치 Sample 구간 UPDATE
//   apiYn='Y' + imasterid={masterId}. Campaign numeric 은 NULL 불가 → 0=미연결
//   WHERE sapiyn='N' 멱등성: 이미 Y 인 행은 건드리지 않음
//   masterId=0 이면 스킵 — Master INSERT 실패 시 유령 성공 방지
//
//   전송 상태 규칙:
//     apiYn='N' + master-id=0  → 미전송
//     apiYn='Y' + master-id>0  → 전송 완료
//     apiYn='N' + master-id>0  → 실패 후 재시도(직전 배치 참조 유지)
// ============================================================
BulkApiWorker.prototype.updateSampleSent = function(masterId, ymd, fromLine, toLine, rowCount) {
  var mid = parseInt(masterId, 10) || 0;
  if (mid === 0) {
    logWarning("[" + this.workerName + "] masterId=0 → Sample 갱신 스킵 (line "
      + fromLine + "~" + toLine + ")");
    return 0;
  }
  if (this.DRY_RUN) {
    logInfo("[" + this.workerName + "][DRY_RUN] Sample 갱신 생략 "
      + ymd + " line " + fromLine + "~" + toLine + " master=" + mid);
    return 0;
  }

  var usql = "UPDATE " + BULK_CFG.MEMBER_TABLE
    + " SET sapiyn='Y', imasterid=" + mid
    + " WHERE singestymd='" + this.sqlLit(ymd) + "'"
    + " AND ilineno BETWEEN " + fromLine + " AND " + toLine
    // sapiyn='N' 은 pending 정의가 아닌 멱등 가드 — PENDING_COND_SQL 과 무관하게 고정
    + " AND sapiyn='N'";

  // sqlExec UPDATE 영향 행 수 반환 — f-sqlExec.html
  var affected = sqlExec(usql);
  var n = parseInt(affected, 10);

  if (!isNaN(n)) {
    // 전송 건수와 UPDATE 영향 행 수 대조
    if (n !== rowCount) {
      logWarning("[" + this.workerName + "] UPDATE 행 수 불일치 기대=" + rowCount
        + " 실제=" + n + " (line " + fromLine + "~" + toLine + ")");
    }
  } else {
    // sqlExec 반환 미지원 빌드만 COUNT 역조회 fallback
    var vsql = "SELECT COUNT(*) AS n FROM " + BULK_CFG.MEMBER_TABLE
      + " WHERE singestymd='" + this.sqlLit(ymd) + "'"
      + " AND ilineno BETWEEN " + fromLine + " AND " + toLine
      + " AND sapiyn='Y' AND imasterid=" + mid;
    try {
      // sqlSelect(format, query). format 필드명 = SELECT 별칭 — f-sqlSelect.html
      var vrs = sqlSelect("row,@n:long", vsql);
      var vn = 0;
      // E4X 빈 XMLList 는 undefined 아님. length() 로 존재 판정
      if (vrs && vrs.row.length() > 0) {
        for each (var vr in vrs.row) { vn = parseInt(String(vr.@n), 10) || 0; }
      }
      if (vn !== rowCount) {
        logWarning("[" + this.workerName + "] Sample 갱신 불일치 기대=" + rowCount
          + " 실제=" + vn + " (" + ymd + " line " + fromLine + "~" + toLine + ")");
      }
    } catch (eV) {
      logWarning("[" + this.workerName + "] 갱신 검증 조회 실패: " + (eV.message || eV));
    }
  }

  return 1;
};


// ============================================================
// # 6. sendSlice — 50MB 분할 + POST + Master + Sample
//   fetch 1회분 records 를 받아 payload 조립 → 초과 시 절반 재귀 분할
//   postNo: 실제 HTTP POST(및 Master) 횟수. fetch batchNo 와 다를 수 있음
//   실패 시 Master(fail)만 기록. apiYn/master-id 는 갱신하지 않음 → 다음 라운드 재시도
// ============================================================
BulkApiWorker.prototype.sendSlice = function(records) {
  if (!records || records.length === 0) {
    return { ok: true, sent: 0, failed: 0 };
  }

  var payload = this.buildPayload(records);

  // profile-bulk-api 50MB 상한. SPLIT_ON_OVERSIZE=true 면 throw 대신 분할
  if (payload.length > BULK_CFG.LIMIT_FILE_BYTES && BULK_CFG.SPLIT_ON_OVERSIZE) {
    if (records.length <= 1000) {
      throw new Error("[" + this.workerName + "] 1000행 이하에서 50MB 초과 — 데이터 이상");
    }
    var half = Math.floor(records.length / 2);
    logWarning("[" + this.workerName + "] " + payload.length + "B > 50MB → "
      + records.length + "행을 " + half + "+" + (records.length - half) + " 분할");
    var r1 = this.sendSlice(records.slice(0, half));
    var r2 = this.sendSlice(records.slice(half));
    return {
      ok:     r1.ok && r2.ok,
      sent:   r1.sent + r2.sent,
      failed: r1.failed + r2.failed
    };
  }

  // BATCH_SIZE 역산 근거. 운영 튜닝 시 이 로그 확인
  logInfo("[" + this.workerName + "] payload " + payload.length + "B / "
    + records.length + "행 / 행당 "
    + Math.round(payload.length / records.length) + "B");

  this.postNo++;
  // DRY_RUN Master 는 batchName 접미 -DRY 로 실전송 이력과 구분
  var batchName = this.workerName + "-" + this.runId + "-" + this.postNo
                + (this.DRY_RUN ? "-DRY" : "");
  var firstLine = records[0].line;
  var endLine   = records[records.length - 1].line;
  var rowCount  = records.length;

  try {
    var apiResult = this.callBulkApiPayload(payload, rowCount);
    logInfo("[" + this.workerName + "] POST #" + this.postNo + " 전송 성공 "
      + apiResult.elapsedMs + "ms (시도 " + apiResult.attempt + "회)"
      + " / batchStatus: " + apiResult.batchStatus);

    var masterId = this.saveMaster({
      batchName:      batchName,
      workerName:     this.workerName,
      recordCount:    rowCount,
      httpCode:       apiResult.code,
      success:        true,
      attemptCount:   apiResult.attempt,
      elapsedMs:      apiResult.elapsedMs,
      batchStatusUrl: apiResult.batchStatus,
      errorMessage:   ""
    });

    this.updateSampleSent(masterId, this.ingestYmd, firstLine, endLine, rowCount);

    logInfo("[" + this.workerName + "] POST #" + this.postNo + " 저장 완료 "
      + "(master " + masterId + " / line " + firstLine + "~" + endLine + ")");

    return { ok: true, sent: rowCount, failed: 0 };

  } catch (e) {
    var err = this.errText(e);
    logWarning("[" + this.workerName + "] POST #" + this.postNo + " 배치 실패: " + err);

    var failCode = 0;
    var codeMatch = String(err).match(/HTTP (\d+)/);
    if (codeMatch) failCode = parseInt(codeMatch[1], 10);

    // 실패 Master 기록. Sample 미갱신 → apiYn='N' 유지 → 다음 라운드 재처리
    try {
      this.saveMaster({
        batchName:      batchName,
        workerName:     this.workerName,
        recordCount:    rowCount,
        httpCode:       failCode,
        success:        false,
        attemptCount:   this.lastAttempt,
        elapsedMs:      0,
        batchStatusUrl: "",
        errorMessage:   err
      });
    } catch (e2) {
      logError("[" + this.workerName + "] 실패 Master 기록 불가: " + this.errText(e2));
    }

    return { ok: false, sent: 0, failed: rowCount };
  }
};


// ============================================================
// # 7. run — 메인 루프
//   순서: 조회 → sendSlice(POST+Master+Sample). batchStatus GET 없음
//   커서 갱신은 try-catch 밖 — 실패 fetch 구간도 커서 전진(무한 루프 방지)
//   실패 행은 apiYn='N' 유지 → Factory 다음 라운드 재분배
// ============================================================
BulkApiWorker.prototype.run = function() {
  var totalProcessed = 0;
  var totalFailed = 0;
  var batchNo = 0;      // queryMembers fetch 횟수
  var lastLine = 0;
  var errorCount = 0;   // 연속 실패 카운터. 성공 시 리셋
  // (변경) lastLine 무진행 감지. 동일 lastLine 이 반복되면 즉시 중단
  var prevLastLine = -1;
  var noProgress = 0;
  var NO_PROGRESS_MAX = 3;
  this.postNo = 0;

  logInfo("[" + this.workerName + "] 시작: " + this.ingestYmd
    + " (BIZ_DATE=" + this.bizDate + ")"
    + " line " + this.lineStart + " ~ " + this.lineEnd
    + " / batch " + this.BATCH_SIZE
    + " / 스로틀 " + this.MIN_INTERVAL_MS + "ms"
    + " / workers=" + this.workerCount
    + " / auth=" + (this.authToken ? "on" : "off")
    + " / custom=" + (this.customAttrs.length ? this.customAttrs.join(",") : "(none)")
    + (this.DRY_RUN ? " / ※DRY_RUN※" : ""));

  while (true) {

    // 1) 조회
    var result = this.queryMembers(lastLine, this.BATCH_SIZE);

    // 2) 배치 구성 — segId 는 DB 사전 적재값. 비어 있으면 throw
    var batchRecords = [];
    for each (var m in result[BULK_CFG.MEMBER_ELEMENT]) {
      var segRaw = String(m.@segId || "").replace(/^\s+|\s+$/g, "");
      if (!segRaw) {
        throw new Error("[" + this.workerName + "] segId 비어 있음 line="
          + m.@lineNo + " — sql/02_seed_segid.sql 또는 운영 적재 필요");
      }
      var extras = {};
      var ei;
      for (ei = 0; ei < this.customAttrs.length; ei++) {
        extras[this.customAttrs[ei]] = this.clipExtra(
          this.readXmlAttr(m, this.customAttrs[ei])
        );
      }
      // (변경) lineNo NaN 방어. 무진행 원인 1순위
      var ln = parseInt(String(m.@lineNo), 10);
      if (isNaN(ln)) {
        throw new Error("[" + this.workerName + "] lineNo 파싱 실패 uid=" + m.@membershipUid);
      }
      batchRecords.push({
        uid:    m.@membershipUid.toString(),
        line:   ln,
        segId:  segRaw,
        extras: extras
      });
    }

    var count = batchRecords.length;
    if (count === 0) {
      logInfo("[" + this.workerName + "] 잔여 0건 → 루프 종료");
      break;
    }
    if (!(batchRecords[0].line >= 1) || !(batchRecords[count - 1].line >= 1)) {
      throw new Error("[" + this.workerName + "] lineNo 없음 — Sample 스키마·백필 후 재실행");
    }

    batchNo++;
    logInfo("[" + this.workerName + "] fetch #" + batchNo + " 조회 " + count
      + "건 (line " + batchRecords[0].line + " ~ " + batchRecords[count - 1].line + ")");

    var sliceResult = this.sendSlice(batchRecords);

    if (sliceResult.ok) {
      totalProcessed += sliceResult.sent;
      errorCount = 0;
    } else {
      totalFailed += sliceResult.failed;
      errorCount++;
      if (errorCount >= BULK_CFG.MAX_ERROR) {
        logError("[" + this.workerName + "] 연속 " + BULK_CFG.MAX_ERROR + "회 실패 → 워커 중단");
        throw new Error("[" + this.workerName + "] 연속 배치 실패");
      }
    }

    // 커서 전진 (성공/실패 무관)
    lastLine = batchRecords[count - 1].line;

    // (변경) 진행 여부 판정. batchRecords 는 있는데 lastLine 이 안 늘면 무진행
    if (lastLine <= prevLastLine) {
      noProgress++;
      logWarning("[" + this.workerName + "] lastLine 무진행 " + noProgress
        + "/" + NO_PROGRESS_MAX + " (lastLine=" + lastLine + ")");
      if (noProgress >= NO_PROGRESS_MAX) {
        throw new Error("[" + this.workerName + "] lastLine 진행 중단 line=" + lastLine
          + " — lineNo 파싱 또는 UPDATE 실패 의심");
      }
    } else {
      noProgress = 0;
    }
    prevLastLine = lastLine;
  }

  logInfo("[" + this.workerName + "] 완료 — 성공 " + totalProcessed
    + "건 / 실패 " + totalFailed + "건 / fetch " + batchNo + "회 / POST " + this.postNo + "회");

  if (totalProcessed === 0 && totalFailed > 0) {
    throw new Error("[" + this.workerName + "] 전 건 실패 " + totalFailed
      + "건. Campaign urlPermission(serverConf.xml) 또는 네트워크 확인");
  }

  return { sent: totalProcessed, failed: totalFailed, batches: batchNo };
};
