// ============================================================
// lgu:bulkApiWorker
// 생성자 + prototype 패턴
// 워커별 독립 인스턴스로 실행
// 제작: Woo
// ============================================================


// --- 생성자: new BulkApiWorker(start, end, name) 호출 시 실행 ---
function BulkApiWorker(uidStart, uidEnd, workerName) {

    // 설정값
    this.CLIENT_CODE   = "ibankapacpartnersand";    // Target Administraion 에서 확인
    this.BATCH_SIZE    = 5000;                      // Batch별 lineCount Default값 -> 워커에서 오버라이딩
    
    // Seg 랜덤 제작용 -> PRD에선 실제 Seg 연결필요
    this.SEG_POOL_SIZE = 50;        // w01 ~ w50
    this.SEG_MIN       = 10;        // seg 최소 개수
    this.SEG_MAX       = 20;        // seg 최대 개수
    
    // UID별 log 저장
    this.SAVE_SCHEMA   = "lgu:lgu_target_bulk_detail";
    this.SAVE_ELEMENT  = "lgu_target_bulk_detail";
    
    // Batch별 log 저장(UID와 1:N 구조)
    this.MASTER_SCHEMA = "lgu:lgu_target_bulk_master";
    this.MASTER_ELEMENT = "lgu_target_bulk_master";
    
    // apiYn flag 업데이트
    this.MEMBER_SCHEMA = "lgu:lgu_member";
    this.MEMBER_TABLE  = "lgulgu_member";
  
    // 워커별 UID 범위 (숫자 offset 대신 실제 UID)
    this.uidStart   = uidStart;
    this.uidEnd     = uidEnd;
    this.workerName = workerName;
  
    // Bulk API v2 엔드포인트
    this.bulkApiUrl = "https://" + this.CLIENT_CODE
      + ".tt.omtrdc.net/m2/" + this.CLIENT_CODE + "/v2/profile/batchUpdate";
  }
  
  
  // --- URL 인코딩 (파이프 등 특수문자 처리) ---
  BulkApiWorker.prototype.urlEncode = function(str) {
    return encodeURIComponent(str);
  };
  
  
  // --- seg_id 생성: Fisher-Yates 셔플로 w01~w50 중 10~20개 추출, 파이프 연결 -> PRD에선 실제 Seg 연결필요 ---
  BulkApiWorker.prototype.generateSegId = function() {
    // 추출할 개수: SEG_MIN ~ SEG_MAX
    var count = this.SEG_MIN + Math.floor(Math.random() * (this.SEG_MAX - this.SEG_MIN + 1));
  
    // w01 ~ w50 풀 생성
    var pool = [];
    for (var i = 1; i <= this.SEG_POOL_SIZE; i++) {
      pool.push("w" + (i < 10 ? "0" + i : "" + i));
    }
  
    // Fisher-Yates 셔플 (앞에서 count개만 섞음 → 중복 원천 차단)
    for (var j = 0; j < count; j++) {
      var r = j + Math.floor(Math.random() * (pool.length - j));
      var tmp = pool[j];
      pool[j] = pool[r];
      pool[r] = tmp;
    }
  
    // "w10|w32|w09|..." 형태 반환
    return pool.slice(0, count).join("|");
  };
  
  
  // --- DB에서 멤버 조회 (E4X XML 반환) ---
  BulkApiWorker.prototype.queryMembers = function(lastUid, fetchSize) {
    // 첫 조회: lastUid가 없으면 uidStart 이상부터 / 이후: 직전 배치 마지막 UID 초과분부터
    var condition;
    if (!lastUid) {
      condition = "@membershipUid >= '" + this.uidStart + "' AND @membershipUid <= '" + this.uidEnd + "'";
    } else {
      condition = "@membershipUid > '" + lastUid + "' AND @membershipUid <= '" + this.uidEnd + "'";
    }
    
    var query = xtk.queryDef.create(
      <queryDef schema={this.MEMBER_SCHEMA} operation="select" distinct="true"
                lineCount={String(fetchSize)}>
        <select>
          <node expr="@membershipUid"/>
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
  
  
  // --- Bulk API POST 호출 (CSV 포맷 + batch= 헤더) ---
  // Bulk API v2 필수 포맷: 첫 줄 "batch=thirdPartyId,seg_id", 이후 행별 "UID,인코딩된seg_id"
  // 참고: https://experienceleague.adobe.com/en/docs/target-dev/developer/api/profile-apis/profile-bulk-api
  BulkApiWorker.prototype.callBulkApi = function(batchRecords) {
    // CSV 조립
    var lines = "batch=thirdPartyId,seg_id\n";
    for (var i = 0; i < batchRecords.length; i++) {
      lines += batchRecords[i].uid + "," + this.urlEncode(batchRecords[i].segId);
      if (i < batchRecords.length - 1) {
        lines += "\n";
      }
    }
  
    var buffer = new MemoryBuffer();
    buffer.fromString(lines, "utf-8");
    
    var maxRetry = 3;
    var req, code, responseBody;
  
    // ── 1단계: HTTP 통신 레벨 (네트워크/서버 상태 판단) ──
    for (var attempt = 1; attempt <= maxRetry; attempt++) {
      req = new HttpClientRequest(this.bulkApiUrl);
      req.method = "POST";
      req.header["Content-Type"] = "application/x-www-form-urlencoded";
      req.body = buffer;
      req.execute();
  
      code = req.response.code;
      responseBody = String(req.response.body);
  
      if (code === 429) {
        // Rate Limit (APIM 경유 시 특히 중요)
        logWarning("[" + this.workerName + "] 429 Rate Limited. 10s 대기 (" + attempt + "/" + maxRetry + ")");
        sleep(10);
        continue;
      }
      if (code >= 500) {
        // 서버 에러 → 재시도 가치 있음
        logWarning("[" + this.workerName + "] HTTP " + code + " 서버에러. 5s 대기 (" + attempt + "/" + maxRetry + ")");
        sleep(5);
        continue;
      }
      if (code >= 400) {
        // 4xx (429 제외) → 요청 자체가 잘못됨, 재시도 무의미
        throw new Error("[" + this.workerName + "] HTTP " + code + " 클라이언트에러 / " + responseBody);
      }
      // 2xx → 통신 성공, 루프 탈출
      break;
    }
  
    if (code === 429 || code >= 500) {
      throw new Error("[" + this.workerName + "] " + maxRetry + "회 재시도 초과 (마지막 HTTP " + code + ")");
    }
  
    // ── 2단계: 비즈니스 레벨 (API 응답 내용 판단) ──
    //    HTTP 200이어도 <success>false</success>일 수 있음
    var successFlag = responseBody.indexOf("<success>true</success>") > -1;
  
    if (!successFlag) {
      throw new Error("[" + this.workerName + "] Bulk API 비즈니스 실패 (HTTP " + code + ") / " + responseBody);
    }
  
    var batchStatus = "";
    var startTag = "<batchStatus>";
    var endTag = "</batchStatus>";
    var startIdx = responseBody.indexOf(startTag);
    var endIdx = responseBody.indexOf(endTag);
    if (startIdx > -1 && endIdx > -1) {
      batchStatus = responseBody.substring(startIdx + startTag.length, endIdx);
    }
  
    return {
      code: code,
      success: true,
      batchStatus: batchStatus
    };
  };
  
  
  // --- 배치 결과 마스터 저장 (WriteCollection, insertOrUpdate) ---
  BulkApiWorker.prototype.saveMaster = function(info) {
    var now = formatDate(new Date(), "%4Y-%2M-%2D %2H:%2N:%2S");
  
    var insertDOM = new DOMDocument(this.MASTER_ELEMENT);
    var root = insertDOM.root;
    root.setAttribute("xtkschema", this.MASTER_SCHEMA);
    root.setAttribute("_operation", "insertOrUpdate");  // ← 변경
    root.setAttribute("_key", "@batchName");            // ← 추가
    root.setAttribute("batchName", info.batchName);
    root.setAttribute("workerName", info.workerName);
    root.setAttribute("recordCount", String(info.recordCount));
    root.setAttribute("httpCode", String(info.httpCode));
    root.setAttribute("success", info.success ? "1" : "0");
    root.setAttribute("batchStatusUrl", info.batchStatusUrl);
    root.setAttribute("errorMessage", info.errorMessage);
    root.setAttribute("lastModified", now);
  
    xtk.session.Write(insertDOM);
  
    var query = xtk.queryDef.create(
      <queryDef schema={this.MASTER_SCHEMA} operation="get">
        <select>
          <node expr="@id"/>
        </select>
        <where>
          <condition expr={"@batchName='" + info.batchName + "'"}/>
        </where>
      </queryDef>
    );
    var result = query.ExecuteQuery();
    return result.@id.toString();
  };
  
  
  // --- 결과 DB 저장 (WriteCollection, insertOrUpdate) ---
  BulkApiWorker.prototype.saveToDb = function(batchRecords, masterId) {
    var now = formatDate(new Date(), "%4Y-%2M-%2D %2H:%2N:%2S");
    var insertDOM = new DOMDocument("collection");
    var root = insertDOM.root;
    root.setAttribute("xtkschema", this.SAVE_SCHEMA);
  
    for (var i = 0; i < batchRecords.length; i++) {
      var el = insertDOM.createElement(this.SAVE_ELEMENT);
      el.setAttribute("_operation", "insertOrUpdate");
      el.setAttribute("_key", "@membershipUid");
      el.setAttribute("membershipUid", batchRecords[i].uid);
      el.setAttribute("segId", batchRecords[i].segId);
      el.setAttribute("lastModified", now);
  
      // Master FK 연결
      el.setAttribute("master-id", masterId);
  
      root.appendChild(el);
    }
    xtk.session.WriteCollection(insertDOM);
  };
  
  
  // --- apiYn 플래그 Y 업데이트 (범위 기반 1회 SQL) ---
  BulkApiWorker.prototype.updateApiYn = function(firstUid, lastUid) {
    sqlExec(
      "UPDATE " + this.MEMBER_TABLE + " SET sapiyn='Y'" +
      " WHERE smembershipuid >= '" + firstUid + "'" +
      " AND smembershipuid <= '" + lastUid + "'" +
      " AND (sapiyn='N' OR sapiyn IS NULL)"
    );
  };
  
  
  // --- 메인 실행: 배치 루프 ---
  BulkApiWorker.prototype.run = function() {
    var totalProcessed = 0;
    var lastUid = "";
    var firstUid = "";
    var batchLastUid = "";
    var runTimestamp = formatDate(new Date(), "%4Y%2M%2D%2H%2N%2S");
    var errorCount = 0;
    var MAX_ERROR = 3;
  
    logInfo("[" + this.workerName + "] 시작: " + this.uidStart + " ~ " + this.uidEnd);
    
    while (true) {
      // 1) 멤버 조회 (UID 범위 + 커서 방식)
      var result = this.queryMembers(lastUid, this.BATCH_SIZE);
  
      // 2) 배치 배열 구성
      var batchRecords = [];
      for each (var m in result.lgu_member) {
        var uid = m.@membershipUid.toString();
        var segId = this.generateSegId();
        batchRecords.push({ uid: uid, segId: segId });
      }
  
      var count = batchRecords.length;
      if (count == 0) {
        logInfo("[" + this.workerName + "] 조회 결과 0건, 루프 종료");
        break;
      }
      logInfo("[" + this.workerName + "] 조회 " + count + "건 (after: " + (lastUid || this.uidStart) + ")");
      
      var batchName = this.workerName + "-" + runTimestamp + "-" + String(totalProcessed + count);
      
      try {
        // 3) Bulk API 호출
        var apiResult = this.callBulkApi(batchRecords);
        logInfo("[" + this.workerName + "] Bulk API 성공 (" + batchRecords[0].uid + " ~ " + batchRecords[count - 1].uid + ")");
        logInfo("[" + this.workerName + "] batchStatus: " + apiResult.batchStatus);
    
        // 4) Master 저장 (배치 단위 1건)
        var masterId = this.saveMaster({
          batchName:      batchName,
          workerName:     this.workerName,
          recordCount:    count,
          httpCode:       apiResult.code,
          success:        true,
          batchStatusUrl: apiResult.batchStatus,
          errorMessage:   ""
        });
        logInfo("[" + this.workerName + "] Master 저장 (id: " + masterId + ")");
        
        // 5) Detail 저장 (건별 N건, master FK 연결)
        this.saveToDb(batchRecords, masterId);
        logInfo("[" + this.workerName + "] Detail 저장 " + count + "건");
        
        // 6) apiYn 업데이트
        firstUid = batchRecords[0].uid;
        batchLastUid = batchRecords[count - 1].uid;
        this.updateApiYn(firstUid, batchLastUid);
        logInfo("[" + this.workerName + "] apiYn 업데이트 (" + firstUid + " ~ " + batchLastUid + ")");
        
        errorCount = 0;
      
      } catch (e) {
        logWarning("[" + this.workerName + "] 배치 실패: " + e.message);
  
        var failCode = 0;
        var codeMatch = e.message.match(/HTTP (\d+)/);
        if (codeMatch) {
          failCode = parseInt(codeMatch[1]);
        }
  
        this.saveMaster({
          batchName:      batchName,
          workerName:     this.workerName,
          recordCount:    count,
          httpCode:       failCode,
          success:        false,
          batchStatusUrl: "",
          errorMessage:   String(e.message).substring(0, 255)
        });
        logWarning("[" + this.workerName + "] 실패 Master 저장 완료");
  
        errorCount++;
        if (errorCount >= MAX_ERROR) {
          logError("[" + this.workerName + "] 연속 " + MAX_ERROR + "회 실패. 워커 중단");
          throw e;
        }
      }  // catch 끝
  
      // 커서 갱신
      batchLastUid = batchRecords[count - 1].uid;
      lastUid = batchLastUid;
      totalProcessed += count;
    }  // while 끝
  
    logInfo("[" + this.workerName + "] 완료. 총 " + totalProcessed + "건 처리");
  };  // run 끝
  
  
  
  