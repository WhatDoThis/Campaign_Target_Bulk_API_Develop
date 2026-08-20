// ============================================================
// wootar:testWooBulkApiWorker.js (Target Bulk Profile 전송 워커)
// ------------------------------------------------------------
// Adobe Target Bulk Profile Update API v2. 워커 WF N개(최대 15)가 loadLibrary로 공유.
// 기본 전송은 thirdPartyId + seg_id. CUSTOM_ATTR로 샘플 스키마 속성을 가변 추가.
// 인스턴스 상태는 this. 스로틀은 workerCount + 첫 호출 워커별 분산.
//
// [Main Functions]
// 1. queryMembers — apiYn N/NULL + UID 커서. CUSTOM_ATTR은 select node 추가
// 2. buildPayload — batch=thirdPartyId,seg_id[,attr...]. 값은 URL-encode
// 3. callBulkApi — POST v2 + 스로틀(첫 호출 워커별 분산) + 429/503 재시도
// 4. pollBatchStatus — POST 직후 짧은 GET. 적재 완료 대기는 하지 않음
// 5. saveMaster / saveToDb / updateApiYn — 제출 로그. 추가 속성은 Detail에 안 남김
// 6. parseCustomAttrs — "@planName, @phoneNumber" 또는 JSON 유사 배열
//
// [Dependencies]
// xtk.queryDef, xtk.session, HttpClientRequest, MemoryBuffer
// [참조] https://experienceleague.adobe.com/en/docs/target-dev/developer/api/profile-apis/profile-bulk-api
//        https://experienceleague.adobe.com/en/docs/target-dev/developer/implementation/methods/profile-api-settings
// ============================================================


// ============================================================
// 환경 설정 — 변경 지점 일원화
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
    //   POST batchUpdate 와 GET profiles/thirdPartyId, batchStatus(mboxedge) 모두 해당
    // AUTH_TOKEN = Profile API 구역 토큰.
    //   1) Profile API > Require Authentication 을 ON
    //   2) Generate New Profile Authentication Token
    //   3) 헤더 Authorization: Bearer {이 값}
    //   OFF면 비움 (헤더 생략). 재발급 시 이전 값으로 호출하면 실패
    //   공식: /docs/target-dev/developer/implementation/methods/profile-api-settings
    AUTH_TOKEN  : "",


    // ---- 처리 규모 ----
    BATCH_SIZE  : 5000,                     // 배치당 행수. 시그널 batchSize로 오버라이드 가능


    // ---- 추가 프로필 속성 (Target profile.{name}) ----
    //   기본 전송: thirdPartyId + seg_id
    //   비어 있으면 추가 컬럼 없음
    //   예: "@planName, @phoneNumber"  또는  '["@planName","@phoneNumber"]'
    //   시그널 customAttr > 여기 값
    //   스키마에 없는 이름은 조회 시 예외. 오디언스는 profile.planName 등으로 사용
    CUSTOM_ATTR   : "",
    EXTRA_VAL_MAX : 256,                    // 속성값 절단. in-mbox profile value 한도에 맞춤


    // ---- 대상 스키마 ----
    MEMBER_SCHEMA  : "wootar:testWooTargetSample",
    MEMBER_ELEMENT : "testWooTargetSample",
    MEMBER_TABLE   : "WootarTestWooTargetSample",   // sqlExec용 물리 테이블


    // ---- 로그 스키마 ----
    MASTER_SCHEMA  : "wootar:testWooTargetBulkApiMaster",   // 배치 단위 1건
    MASTER_ELEMENT : "testWooTargetBulkApiMaster",
    SAVE_SCHEMA    : "wootar:testWooTargetBulkApiDetail",   // 건별 N건
    SAVE_ELEMENT   : "testWooTargetBulkApiDetail",


    // ---- 세그먼트 (현재 더미) ----
    SEG_POOL_SIZE  : 50,        // w01 ~ w50
    SEG_MIN        : 10,
    SEG_MAX        : 20,
    SEG_MAX_LEN    : 255,       // Detail.segId / Target 전송 공통 상한


    // ---- 재시도 / 대기 (sleep 단위 = milliseconds, 공식) ----
    MAX_RETRY      : 3,
    WAIT_429_MS    : 10000,     // 프록시/APIM 레이트 리밋
    WAIT_503_MS    : 65000,     // Target 계정 한도 초과. 한도 창이 분 단위라 65초
    WAIT_5XX_MS    : 5000,      // 그 외 서버 오류 (500/502/504)
    MAX_ERROR      : 3,         // 연속 배치 실패 허용 횟수
    ERR_MSG_MAX    : 255,       // Master.errorMessage 기록 상한 (컬럼은 memo)


    // ---- batchStatus 짧은 조회 ----
    //   적재는 비동기(최대 24시간). 워커에서 완료를 기다리지 않음
    //   POST 직후 1~N회 GET. incomplete면 Master에 남기고 후속 잡이 재조회
    POLL_MAX       : 2,
    POLL_WAIT_MS   : 3000,


    // ---- 레이트 리밋 방어 ----
    //   Target 한도: bulk profile update API 50 calls/min, 계정 전체 공유
    //   초과 시 429 아닌 503 반환
    //   https://experienceleague.adobe.com/en/docs/target/using/troubleshoot/target-limits
    ACCOUNT_CPM    : 50,        // 계정 분당 콜 한도 (Adobe 고정값)
    WORKER_COUNT   : 5,         // 동시 가동 워커 수 기본값. 시그널 workerCount 우선
    WORKER_MAX     : 15,        // 최대 15. Factory가 이 값으로 클램프
    SAFETY_RATIO   : 0.7,       // 안전 마진. 타 팀 Admin/Reporting API 사용분 고려
    STAGGER_SLOT_MS: 1200,      // 워커 첫 POST 분산. 50콜/분 = 1.2s/콜. TBAW1=0, TBAW2=1.2s ...


    // ---- Target 규격 상한 ----
    LIMIT_ROWS       : 500000,          // 배치당 행수
    LIMIT_FILE_BYTES : 50 * 1024 * 1024, // 배치 파일 크기
    LIMIT_URL_LEN    : 255              // Master.batchStatusUrl 컬럼 길이
  };


// ============================================================
// 생성자
//   p = 시그널 파라미터(vars)
//   필수: workerName, uidStart, uidEnd
//   선택: batchSize, dryRun, runId, workerCount, authToken, customAttr
// ============================================================
function BulkApiWorker(p) {
  p = p || {};

  this.workerName = String(p.workerName || "W0");
  this.uidStart   = String(p.uidStart || "");
  this.uidEnd     = String(p.uidEnd || "");

  // runId: 회차 식별자. Distributor가 전 워커에 동일값 주입 시 회차 단위 조회 가능
  //        미주입 시 워커별 자체 생성 (회차 묶음 조회 불가)
  this.runId = String(p.runId || formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S"));

  this.BATCH_SIZE = parseInt(p.batchSize, 10) || BULK_CFG.BATCH_SIZE;

  // DRY_RUN: API 전송 + apiYn 갱신만 생략. 조회/CSV조립/Master/Detail은 실제 수행
  this.DRY_RUN = (String(p.dryRun || "") === "true");

  this.bulkApiUrl = "https://" + BULK_CFG.CLIENT_CODE
    + ".tt.omtrdc.net/m2/" + BULK_CFG.CLIENT_CODE + "/v2/profile/batchUpdate";

  // 토큰: 시그널 authToken > BULK_CFG.AUTH_TOKEN (Profile API 토큰). 둘 다 비면 헤더 생략
  this.authToken = this.resolveAuthToken(p);

  // 추가 속성: 시그널 customAttr > BULK_CFG.CUSTOM_ATTR
  this.customAttrs = this.parseCustomAttrs(this.resolveCustomAttrRaw(p));

  if (this.uidStart === "" || this.uidEnd === "") {
    throw new Error("[" + this.workerName + "] uidStart / uidEnd 미주입");
  }
  if (this.BATCH_SIZE > BULK_CFG.LIMIT_ROWS) {
    throw new Error("[" + this.workerName + "] BATCH_SIZE " + this.BATCH_SIZE
      + " > Target 상한 " + BULK_CFG.LIMIT_ROWS);
  }

  // 스로틀 간격 = 60초 / (계정한도 × 안전마진 / 워커수)
  //   워커 5개 기준 약 8,572ms. 15개면 약 25,715ms
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

  var perWorkerCpm = (BULK_CFG.ACCOUNT_CPM * BULK_CFG.SAFETY_RATIO) / workerCount;
  // 설정 오타로 0이 되면 60000/0 → Infinity → sleep 무한 대기
  if (!(perWorkerCpm > 0)) perWorkerCpm = 1;
  this.MIN_INTERVAL_MS = Math.ceil(60000 / perWorkerCpm);

  this.lastCallMs = 0;    // 직전 API 호출 시각. 0 = 미호출
  this.lastAttempt = 0;   // 직전 배치의 실제 시도 횟수. 실패 Master 기록용
}


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
//   예약(membershipUid, apiYn, seg_id, thirdPartyId)은 제외
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
        || key === "seg_id" || key === "thirdpartyid") {
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


// --- Target/Detail 공통 길이 상한. 운영 generateSegId 교체 시에도 호출부에서 절단 ---
BulkApiWorker.prototype.clipSegId = function(seg) {
  var s = String(seg === undefined || seg === null ? "" : seg);
  if (s.length > BULK_CFG.SEG_MAX_LEN) {
    return s.substring(0, BULK_CFG.SEG_MAX_LEN);
  }
  return s;
};


// ============================================================
// seg_id 생성  ★★ 운영 전환 지점 ★★
//   현재: w01~w50 풀에서 Fisher-Yates 셔플로 중복 없이 10~20개 추출한 더미
//   운영: 이 함수 본문만 실제 세그 산출 로직으로 교체
//         호출부(run)는 파이프 연결 문자열 1개만 기대 → 시그니처 유지 시 타 코드 영향 없음
//         반환 길이 상한: SEG_MAX_LEN(255). clipSegId로 보장
// ============================================================
BulkApiWorker.prototype.generateSegId = function() {
  var count = BULK_CFG.SEG_MIN
            + Math.floor(Math.random() * (BULK_CFG.SEG_MAX - BULK_CFG.SEG_MIN + 1));

  var pool = [];
  for (var i = 1; i <= BULK_CFG.SEG_POOL_SIZE; i++) {
    pool.push("w" + (i < 10 ? "0" + i : "" + i));
  }

  // 앞 count개만 셔플 → 전체 셔플 대비 연산량 절감
  for (var j = 0; j < count; j++) {
    var r = j + Math.floor(Math.random() * (pool.length - j));
    var tmp = pool[j];
    pool[j] = pool[r];
    pool[r] = tmp;
  }

  return this.clipSegId(pool.slice(0, count).join("|"));
};


// ============================================================
// 멤버 조회 — UID 범위 + 커서 페이징
//   첫 호출: uidStart 이상 / 이후: 직전 배치 마지막 UID 초과
//
//   [주의] NULL 도 미전송으로 본다. 갱신 SQL과 동일 (3값 논리)
//          Sample은 notNull+sqlDefault N 이라 결과는 @apiYn='N'과 같음
//   [주의] distinct 미사용 — membershipUid 유니크. 5천만 건에서 정렬 비용만 발생
// ============================================================
BulkApiWorker.prototype.queryMembers = function(lastUid, fetchSize) {

  var lo = lastUid ? lastUid : this.uidStart;
  var op = lastUid ? ">" : ">=";
  var condition = "(@apiYn = 'N' OR @apiYn IS NULL)"
    + " AND @membershipUid " + op + " '" + this.sqlLit(lo) + "'"
    + " AND @membershipUid <= '" + this.sqlLit(this.uidEnd) + "'";

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
        {extraNodes}
      </select>
      <where>
        <condition expr={condition}/>
      </where>
      <orderBy>
        <node expr="@membershipUid" sortDesc="false"/>
      </orderBy>
    </queryDef>
  );

  return query.ExecuteQuery();
};


// ============================================================
// CSV 페이로드 조립
//   기본: "batch=thirdPartyId,seg_id" + UID,seg
//   CUSTOM_ATTR 있으면 헤더·행에 컬럼 추가 → Target profile.{name}
//   공식: 파라미터와 값은 UTF-8 URL-encode. 빈 칸은 기존 값을 지우지 않음
//   배열 + join 사용 — 문자열 += 누적은 SpiderMonkey에서 O(n²)
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

  var payload = rows.join("\n");

  // URL 인코딩 후 전 문자가 ASCII → length == byte
  if (payload.length > BULK_CFG.LIMIT_FILE_BYTES) {
    throw new Error("[" + this.workerName + "] 배치 파일 "
      + (payload.length / 1048576).toFixed(1) + "MB > 50MB 상한 (BATCH_SIZE 축소 대상)");
  }

  return payload;
};


// ============================================================
// 호출 간격 스로틀
//   직전 호출로부터 MIN_INTERVAL_MS 미경과 시 잔여 시간만큼 대기
//   조회/Detail 저장이 간격보다 오래 걸리면 no-op → 느린 구간엔 부하 없음
//   재시도·batchStatus GET 포함 매 HTTP 호출 직전 적용
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
// Bulk API POST — 2단계 판정
//   1단계 HTTP: 429/503/5xx = 대기 후 재시도, 4xx = 즉시 실패
//   2단계 비즈니스: HTTP 200 + <success>false</success> 가능
//
//   [유지] MemoryBuffer 루프 밖 1회 생성
//          body 대입 시 "copied without alteration" → 재시도 재사용 안전
//          https://experienceleague.adobe.com/developer/campaign-api/api/p-HttpClientRequest-body.html
// ============================================================
BulkApiWorker.prototype.callBulkApi = function(batchRecords) {

  var payload = this.buildPayload(batchRecords);

    // DRY_RUN: 전송만 생략. 반환 계약은 실전송과 동일 키 유지
    //   헤더만 로그. 본문 앞부분은 전화번호 등 개인정보가 들어갈 수 있음
    if (this.DRY_RUN) {
    var headerEnd = payload.indexOf("\n");
    var headerLine = (headerEnd > 0) ? payload.substring(0, headerEnd) : payload;
    logInfo("[" + this.workerName + "][DRY_RUN] 전송 생략 rows=" + batchRecords.length
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

    // 503: Target 계정 한도(50 calls/min) 초과. 5xx와 동일 취급 시 같은 창 재시도로 반드시 재발
    if (code === 503) {
      logWarning("[" + this.workerName + "] HTTP 503 Target 분당 50콜 한도 초과 → "
        + (BULK_CFG.WAIT_503_MS / 1000) + "s 대기 (" + attempt + "/" + BULK_CFG.MAX_RETRY + ")"
        + " / 반복 시 WORKER_COUNT 축소 또는 BATCH_SIZE 확대 검토");
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

  // batchStatus URL 추출. pollBatchStatus가 showDetails=true로 이어서 GET
  var batchStatus = this.xmlTag(responseBody, "batchStatus");

  return {
    code:        code,
    success:     true,
    batchStatus: batchStatus,
    attempt:     attempt,
    elapsedMs:   netMs      // 대기 시간 제외 → 순수 API 성능 지표
  };
};


// ============================================================
// batchStatus 짧은 조회
//   공식: 응답 URL을 그대로 GET. showDetails=true 면 건수 집계
//   실패해도 제출 성공을 뒤집지 않음. Master에 부분 상태만 남김
// ============================================================
BulkApiWorker.prototype.pollBatchStatus = function(statusUrl) {
  var blank = {
    ingestStatus: "", consumedCount: 0, successfulUpdates: 0,
    failedUpdates: 0, profilesNotFound: 0, checked: false
  };

  if (this.DRY_RUN || !statusUrl || statusUrl === "DRYRUN") return blank;

  var url = statusUrl;
  if (url.indexOf("showDetails=") < 0) {
    url += (url.indexOf("?") >= 0 ? "&" : "?") + "showDetails=true";
  }

  var last = blank;
  var i;

  for (i = 1; i <= BULK_CFG.POLL_MAX; i++) {
    if (i > 1) sleep(BULK_CFG.POLL_WAIT_MS);

    try {
      this.throttle();
      var req = new HttpClientRequest(url);
      req.method = "GET";
      this.applyAuth(req);
      req.execute();

      var httpCode = req.response.code;
      var body = String(req.response.body || "");
      // execute()는 HTTP 4xx/5xx에서 예외를 안 던질 수 있음. 본문만 파싱하면 checked=true 오기록
      if (httpCode < 200 || httpCode >= 300) {
        logWarning("[" + this.workerName + "] batchStatus HTTP " + httpCode
          + " (제출은 유지, 이번 GET 무시)");
        continue;
      }

      var st = this.xmlTag(body, "status");
      last = {
        ingestStatus:     st,
        consumedCount:    parseInt(this.xmlTag(body, "consumedCount"), 10) || 0,
        successfulUpdates: parseInt(this.xmlTag(body, "successfulUpdates"), 10) || 0,
        failedUpdates:    parseInt(this.xmlTag(body, "failedUpdates"), 10) || 0,
        profilesNotFound: parseInt(this.xmlTag(body, "profilesNotFound"), 10) || 0,
        checked:          true
      };

      logInfo("[" + this.workerName + "] batchStatus #" + i + " status=" + st
        + " consumed=" + last.consumedCount
        + " ok=" + last.successfulUpdates
        + " fail=" + last.failedUpdates);

      if (st === "complete" || st === "stuck") break;
    } catch (e) {
      logWarning("[" + this.workerName + "] batchStatus 조회 실패(제출은 유지): " + e.message);
      break;
    }
  }

  return last;
};


// ============================================================
// Master 저장 — 배치 1건. 성공/실패 공통
//   insertOrUpdate + _key=@batchName → 동일 batchName 재실행 시 최종 상태만 잔존
//   Write는 반환값 없음 → autopk는 batchName으로 재조회
//   재조회 비용: 배치당 1회 (5천만 건 / 배치 5000 = 1만 회, 무시 가능)
//
//   operation="get" 유지 — Write 직후라 미존재 = Write 실패. 예외 노출이 정상
// ============================================================
BulkApiWorker.prototype.saveMaster = function(info) {
  var now = formatDate(new Date(), "%4Y-%2M-%2D %2H:%2N:%2S");

  var insertDOM = new DOMDocument(BULK_CFG.MASTER_ELEMENT);
  var root = insertDOM.root;
  root.setAttribute("xtkschema",      BULK_CFG.MASTER_SCHEMA);
  root.setAttribute("_operation",     "insertOrUpdate");
  root.setAttribute("_key",           "@batchName");
  // 컬럼 length 초과 시 Write 실패 → 제출 성공 배치가 catch로 떨어짐
  root.setAttribute("batchName",      String(info.batchName || "").substring(0, 100));
  root.setAttribute("workerName",     String(info.workerName || "").substring(0, 20));
  root.setAttribute("runId",          String(this.runId || "").substring(0, 40));
  root.setAttribute("recordCount",    String(info.recordCount || 0));
  root.setAttribute("httpCode",       String(info.httpCode || 0));
  root.setAttribute("success",        info.success ? "1" : "0");
  root.setAttribute("attemptCount",   String(info.attemptCount || 0));
  root.setAttribute("elapsedMs",      String(info.elapsedMs || 0));
  root.setAttribute("lastModified",   now);

  // 컬럼 길이 초과 시 Write 실패 → 진입 전 절단
  root.setAttribute("batchStatusUrl",
    String(info.batchStatusUrl || "").substring(0, BULK_CFG.LIMIT_URL_LEN));
  root.setAttribute("errorMessage",
    String(info.errorMessage || "").substring(0, BULK_CFG.ERR_MSG_MAX));

  // 짧은 조회를 했을 때만 적재 컬럼을 채움. 실패 배치는 비움
  if (info.ingestChecked) {
    // enum batchStatusEnum 값만 기록. 그 외 문자열은 Write가 스키마에서 거절할 수 있음
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
// Detail 저장 — 건별 N건. 성공 배치만 기록
//   [규칙] xtkschema = 컬렉션 루트 / _operation, _key = 각 자식 엘리먼트
//          루트 누락 시 XFR-180000 (schema '.xml' does not exist)
//   master-id = 링크 외래키. 공식 문서 folder-id=1203 패턴과 동일하게 속성 직접 세팅
//   https://experienceleague.adobe.com/en/docs/campaign-classic/using/configuring-campaign-classic/api/data-oriented-apis
// ============================================================
BulkApiWorker.prototype.saveToDb = function(batchRecords, masterId) {
  var now = formatDate(new Date(), "%4Y-%2M-%2D %2H:%2N:%2S");

  var mid = parseInt(masterId, 10) || 0;
  if (mid === 0) {
    // 링크 없는 고아 레코드 방지. 배치 자체는 이미 전송 완료 상태
    logWarning("[" + this.workerName + "] masterId 미확보 → Detail 저장 생략 ("
      + batchRecords.length + "건)");
    return 0;
  }

  var insertDOM = new DOMDocument("collection");
  var root = insertDOM.root;
  root.setAttribute("xtkschema", BULK_CFG.SAVE_SCHEMA);   // 루트에 선언

  for (var i = 0; i < batchRecords.length; i++) {
    var el = insertDOM.createElement(BULK_CFG.SAVE_ELEMENT);
    el.setAttribute("_operation",    "insertOrUpdate");
    el.setAttribute("_key",          "@membershipUid");
    el.setAttribute("membershipUid", batchRecords[i].uid);
    el.setAttribute("segId",         this.clipSegId(batchRecords[i].segId));
    el.setAttribute("lastModified",  now);
    el.setAttribute("master-id",     String(mid));
    root.appendChild(el);
  }

  xtk.session.WriteCollection(insertDOM);
  return batchRecords.length;
};


// ============================================================
// apiYn = 'Y' 갱신 — UID 범위 기반 단일 UPDATE
//   워커 간 UID 구간 비중첩 전제 → 행 경합 없음
//   조회가 N/NULL 대상이므로 범위 내 기존 'Y'는 WHERE에서 자연 제외
// ============================================================
BulkApiWorker.prototype.updateApiYn = function(firstUid, lastUid) {

  if (this.DRY_RUN) {
    logInfo("[" + this.workerName + "][DRY_RUN] apiYn 갱신 생략 " + firstUid + " ~ " + lastUid);
    return;
  }

  sqlExec(
    "UPDATE " + BULK_CFG.MEMBER_TABLE + " SET sapiyn='Y'" +
    " WHERE smembershipuid >= '" + this.sqlLit(firstUid) + "'" +
    " AND smembershipuid <= '" + this.sqlLit(lastUid) + "'" +
    " AND (sapiyn='N' OR sapiyn IS NULL)"
  );
};


// ============================================================
// 메인 루프
//   순서: 조회 → 전송 → (짧은)batchStatus → Master → Detail → apiYn
//   커서 갱신은 try-catch 밖 — 실패 배치에서 커서 정지 시 동일 구간 무한 반복
//   실패분은 apiYn='N' 유지 → 다음 라운드 자연 재처리
// ============================================================
BulkApiWorker.prototype.run = function() {
  var totalProcessed = 0;
  var totalFailed = 0;
  var batchNo = 0;
  var lastUid = "";
  var errorCount = 0;   // 연속 실패 카운터. 성공 시 리셋

  logInfo("[" + this.workerName + "] 시작: " + this.uidStart + " ~ " + this.uidEnd
    + " / batch " + this.BATCH_SIZE
    + " / 스로틀 " + this.MIN_INTERVAL_MS + "ms"
    + " / workers=" + this.workerCount
    + " / auth=" + (this.authToken ? "on" : "off")
    + " / custom=" + (this.customAttrs.length ? this.customAttrs.join(",") : "(none)")
    + (this.DRY_RUN ? " / ※DRY_RUN※" : ""));

  while (true) {

    // 1) 조회
    var result = this.queryMembers(lastUid, this.BATCH_SIZE);

    // 2) 배치 구성
    var batchRecords = [];
    for each (var m in result[BULK_CFG.MEMBER_ELEMENT]) {
      var extras = {};
      var ei;
      for (ei = 0; ei < this.customAttrs.length; ei++) {
        extras[this.customAttrs[ei]] = this.clipExtra(
          this.readXmlAttr(m, this.customAttrs[ei])
        );
      }
      batchRecords.push({
        uid:    m.@membershipUid.toString(),
        segId:  this.generateSegId(),
        extras: extras
      });
    }

    var count = batchRecords.length;
    if (count === 0) {
      logInfo("[" + this.workerName + "] 잔여 0건 → 루프 종료");
      break;
    }

    batchNo++;
    var firstUid  = batchRecords[0].uid;
    var endUid    = batchRecords[count - 1].uid;
    var batchName = this.workerName + "-" + this.runId + "-" + batchNo;

    logInfo("[" + this.workerName + "] #" + batchNo + " 조회 " + count
      + "건 (" + firstUid + " ~ " + endUid + ")");

    try {
      // 3) 전송
      var apiResult = this.callBulkApi(batchRecords);
      logInfo("[" + this.workerName + "] #" + batchNo + " 전송 성공 "
        + apiResult.elapsedMs + "ms (시도 " + apiResult.attempt + "회)"
        + " / batchStatus: " + apiResult.batchStatus);

      // 3b) 적재 상태 짧은 조회. incomplete여도 제출 성공으로 진행
      var ingest = this.pollBatchStatus(apiResult.batchStatus);

      // 4) Master
      var masterId = this.saveMaster({
        batchName:         batchName,
        workerName:        this.workerName,
        recordCount:       count,
        httpCode:          apiResult.code,
        success:           true,
        attemptCount:      apiResult.attempt,
        elapsedMs:         apiResult.elapsedMs,
        batchStatusUrl:    apiResult.batchStatus,
        errorMessage:      "",
        ingestChecked:     ingest.checked,
        ingestStatus:      ingest.ingestStatus,
        consumedCount:     ingest.consumedCount,
        successfulUpdates: ingest.successfulUpdates,
        failedUpdates:     ingest.failedUpdates,
        profilesNotFound:  ingest.profilesNotFound
      });

      // 5) Detail
      var saved = this.saveToDb(batchRecords, masterId);

      // 6) apiYn
      this.updateApiYn(firstUid, endUid);

      logInfo("[" + this.workerName + "] #" + batchNo + " 저장 완료 "
        + "(master " + masterId + " / detail " + saved + "건 / apiYn 갱신"
        + (ingest.checked ? " / ingest=" + ingest.ingestStatus : "") + ")");

      totalProcessed += count;
      errorCount = 0;

    } catch (e) {
      totalFailed += count;
      var err = this.errText(e);
      logWarning("[" + this.workerName + "] #" + batchNo + " 배치 실패: " + err);

      // 에러 메시지에서 HTTP 코드 역추출. 미검출 시 0 (DB 오류 등 비HTTP 원인)
      var failCode = 0;
      var codeMatch = String(err).match(/HTTP (\d+)/);
      if (codeMatch) failCode = parseInt(codeMatch[1], 10);

      // 실패도 Master 기록. Detail 미저장 + apiYn='N' 유지 → 다음 라운드 재처리
      try {
        this.saveMaster({
          batchName:      batchName,
          workerName:     this.workerName,
          recordCount:    count,
          httpCode:       failCode,
          success:        false,
          attemptCount:   this.lastAttempt,   // 실제 시도 횟수 (4xx는 1회)
          elapsedMs:      0,
          batchStatusUrl: "",
          errorMessage:   err
        });
      } catch (e2) {
        // Master 기록 실패 = DB 자체 이상. 로그만 남기고 루프 유지
        logError("[" + this.workerName + "] 실패 Master 기록 불가: " + this.errText(e2));
      }

      errorCount++;
      if (errorCount >= BULK_CFG.MAX_ERROR) {
        logError("[" + this.workerName + "] 연속 " + BULK_CFG.MAX_ERROR + "회 실패 → 워커 중단");
        throw e;
      }
    }

    // 커서 전진 (성공/실패 무관)
    lastUid = endUid;
  }

  logInfo("[" + this.workerName + "] 완료 — 성공 " + totalProcessed
    + "건 / 실패 " + totalFailed + "건 / 배치 " + batchNo + "회");

  if (totalProcessed === 0 && totalFailed > 0) {
    throw new Error("[" + this.workerName + "] 전 건 실패 " + totalFailed
      + "건. Campaign urlPermission(serverConf.xml) 또는 네트워크 확인");
  }

  return { sent: totalProcessed, failed: totalFailed, batches: batchNo };
};
