# old_ver Logic

Adobe Campaign Classic 워크플로우가 미전송 회원(`apiYn = N`)을 조회하고, Adobe Target Bulk Profile Update API v2로 프로필을 배치 전송한다.

이 문서는 `old_ver` 코드의 실행 계약이다. 구현을 읽을 때 이 문서의 변수명·상태값·분기 조건을 그대로 사용한다.

---

## 1. 한 줄 요약

```
소스(lgu_member, apiYn=N)
  → Factory가 UID 범위로 N개 Worker에 분배
  → Worker가 BATCH_SIZE씩 조회 → Bulk API POST → 로그 저장 → apiYn=Y
  → Factory가 Option으로 완료를 폴링하고, 남은 건이 있으면 다음 라운드
```

---

## 2. 구성 요소

```
old_ver/
  workflow/factory/workerDistributor.js   Factory. 대상 건수 계산, UID 범위 분배, PostEvent
  workflow/factory/polling.js             Factory. WORKER_DONE_* Option 폴링
  workflow/worker/worker.js               Worker. Signal 수신 후 BulkApiWorker 실행
  js/bulkApiWorker.js                     라이브러리 lgu:bulkApiWorker. API 호출 + 저장
  schema/lgu_member.xml                   샘플 고객. API 테스트 전용. PRD 소스 아님
  schema/lgu_target_bulk_master.xml       배치 단위 전송 로그. 신버전에서도 동일 역할
  schema/lgu_target_bulk_detail.xml       UID 단위 전송 로그. Master 1:N. 신버전에서도 동일 역할
```

| 역할 | Campaign 구성 | 코드 | 통신 |
|---|---|---|---|
| Factory | 메인 워크플로우 | `workerDistributor.js`, `polling.js` | `xtk.workflow.PostEvent`로 Worker 기동, `setOption`/`getOption`으로 상태 공유 |
| Worker | TBAW1 ~ TBAWN 워크플로우 | `worker.js` | Signal 수신 → 라이브러리 실행 → Option 갱신 |
| Library | JS 라이브러리 `lgu:bulkApiWorker` | `bulkApiWorker.js` | Target Bulk API HTTP POST |

Factory와 Worker는 같은 프로세스에서 호출하지 않는다. Factory는 이벤트만 보내고, Worker 완료는 Option 키로만 확인한다.

---

## 3. 전체 흐름

```
Start
  |
  v
jsWD workerDistributor ----PostEvent signalTBAWn----> Worker TBAW1..N
  |                                                      |
  v                                                      | setOption WORKER_DONE_*
1m Wait                                                  |
  |                                                      |
  v                                                      |
jsP polling <--------------------------------------------+
  |
  v
Test
  |-- Working...  --> 1m Wait --> (다시 jsP polling)
  |-- Next Work   --> (다시 jsWD workerDistributor)
  |-- Finish      --> End
```

### Test 분기 (코드와 동일한 조건)

| 분기 | 조건 | 다음 |
|---|---|---|
| Working... | `instance.vars.workersComplete == "false"` | 1분 대기 후 다시 polling |
| Next Work | `workersComplete == "true"` AND `allDone != "true"` AND `parseInt(globalProcessed) < 100000` | workerDistributor 재실행 |
| Finish | `instance.vars.allDone == "true"` | End |

매칭되지 않는 조합은 분기가 없다. 특히 `workersComplete == true` 이고 `allDone != true` 이고 `globalProcessed >= 100000` 이면 워크플로우가 멈출 수 있다.

`TOTAL_LIMIT`는 500000 인데 Test의 다음 라운드 한도는 100000 이다. 두 값은 서로 다른 상수이며, 코드상 동기화되어 있지 않다.

---

## 4. Factory — workerDistributor

파일: `old_ver/workflow/factory/workerDistributor.js`

### 4.1 설정값

| 변수 | 기본값 | 의미 |
|---|---|---|
| `instance.vars.WORKER_COUNT` | 5 | 기동할 Worker 수. 이름 규칙 `TBAW1` .. `TBAW5` |
| `instance.vars.TOTAL_LIMIT` | 500000 | 이번 라운드에서 처리할 최대 건수 |
| `instance.vars.BATCH_SIZE` | 5000 | Worker가 한 번에 조회/전송하는 건수. PostEvent로 전달 |

### 4.2 처리 순서

```
count apiYn = N or NULL
  |
  v
remaining = min(TOTAL_LIMIT, pending)
  |
  +-- remaining <= 0 --> allDone = true / 분배 없이 종료
  |
  +-- remaining > 0
        |
        v
      allDone = false
        |
        v
      perWorker = ceil(remaining / WORKER_COUNT)
        |
        v
      워커별 startLine/lineCount로 UID 경계 조회
        |
        +-- uidStart/uidEnd 없음 --> 해당 워커 skip
        |
        +-- 있음 --> Option ready + PostEvent
                      |
                      v
                    activeWorkers, workerNames, roundSize 저장
```

1. `lgu:lgu_member`에서 `@apiYn = 'N' OR @apiYn IS NULL` 건수를 `count` 한다. distinct 기준은 `@membershipUid`.
2. `remaining = min(TOTAL_LIMIT, totalPending)`.
3. `remaining <= 0` 이면 `allDone = "true"` 후 분배를 하지 않는다.
4. 그 외 `allDone = "false"`.
5. `perWorker = ceil(remaining / WORKER_COUNT)`.
6. 워커 `w`의 offset은 `w * perWorker`, 할당 건수는 `min(perWorker, remaining - offset)`.
7. 할당 건수가 0이면 해당 워커는 skip 한다. Option을 쓰지 않는다.
8. 시작 UID: `startLine = offset`, `lineCount = 1`, `@membershipUid` 오름차순.
9. 끝 UID:
   - 마지막 워커: `startLine = remaining - 1`
   - 그 외: `startLine = offset + size - 1`
10. UID가 비면 skip.
11. `setOption("WORKER_DONE_" + wName, "ready")`.
12. `xtk.workflow.PostEvent(wName, "signal" + wName, ..., variables)`.
13. `activeWorkers`, `workerNames`(콤마 결합), `roundSize = remaining` 저장.

### 4.3 PostEvent payload

Worker 워크플로우명과 Signal명은 같은 번호로 맞춰야 한다.

| 필드 | 예 | 수신 위치 |
|---|---|---|
| `uidStart` | 범위 시작 membershipUid | `vars.uidStart` |
| `uidEnd` | 범위 끝 membershipUid | `vars.uidEnd` |
| `workerName` | `TBAW1` | `vars.workerName` |
| `batchSize` | `5000` | `vars.batchSize` → `worker.BATCH_SIZE` |

분배 단위는 숫자 offset이 아니라 **실제 UID 문자열 범위**이다. Worker는 `@membershipUid >= uidStart AND <= uidEnd`로 다시 조회한다.

### 4.4 분배 예시

`remaining = 12000`, `WORKER_COUNT = 5` → `perWorker = 2400`

| Worker | offset | size | 시작 UID 위치 | 끝 UID 위치 |
|---|---|---|---|---|
| TBAW1 | 0 | 2400 | 0번째 | 2399번째 |
| TBAW2 | 2400 | 2400 | 2400번째 | 4799번째 |
| TBAW3 | 4800 | 2400 | 4800번째 | 7199번째 |
| TBAW4 | 7200 | 2400 | 7200번째 | 9599번째 |
| TBAW5 | 9600 | 2400 | 9600번째 | 11999번째 (`remaining - 1`) |

---

## 5. Factory — polling

파일: `old_ver/workflow/factory/polling.js`

### 5.1 워커 상태

Option 키: `WORKER_DONE_TBAW{n}`

```
Distributor setOption
  |
  v
ready  (PostEvent 후 Worker 미기동)
  |-- Worker Signal 수신 ---------> running  (BulkApiWorker.run 진행)
  |                                   |-- 정상 종료 --> done
  |                                   +-- catch     --> error
  +-- ready 3회 연속 ---------------> error
```

| 상태 | 의미 | polling 동작 |
|---|---|---|
| `done` | 해당 워커 완료 | 통과 |
| `error` | 워커 예외 | `hasError = true` 후 즉시 중단 |
| `ready` | 아직 미기동 | 라운드별 재시도 카운트 +1. 3회면 에러 |
| 그 외 (`running` 포함) | 진행 중 | `readyRetry` 리셋, `allDone = false` |

`MAX_READY_RETRY = 3`. 카운트 키는 `instance.vars.readyRetry_TBAW{n}`.

### 5.2 라운드 완료 판정

모든 워커가 `done`이면:

```
globalProcessed += roundSize
workersComplete = "true"
```

하나라도 미완료면 `workersComplete = "false"`.

`hasError`이면 `throw` 하여 워크플로우를 중단한다. 부분 성공 재개 로직은 없다.

### 5.3 폴링 범위와 skip 워커

polling은 `activeWorkers`가 아니라 `1 .. WORKER_COUNT` 전체를 본다.

- skip된 워커의 Option이 비어 있으면 `else`(진행 중)로 보고 라운드가 끝나지 않을 수 있다.
- 이전 라운드 값이 `done`으로 남아 있으면 skip된 워커를 완료로 오인할 수 있다.

---

## 6. Worker

파일: `old_ver/workflow/worker/worker.js`

```
signalTBAWn
  --> worker.js
  --> loadLibrary lgu:bulkApiWorker
  --> setOption running
  --> new BulkApiWorker / run
        |-- 성공 --> setOption done  --> End
        +-- 예외 --> setOption error --> End
```

1. `loadLibrary("lgu:bulkApiWorker", false)`
2. `setOption("WORKER_DONE_" + workerName, "running")`
3. `new BulkApiWorker(uidStart, uidEnd, workerName)`
4. `vars.batchSize`가 있으면 `BATCH_SIZE`를 덮어쓴다
5. `worker.run()`
6. 성공 시 `done`, 실패 시 `error` + `logError`

Worker 워크플로우 자체는 Signal → JS → End 단선이다. 배치 루프는 라이브러리 안에 있다.

---

## 7. BulkApiWorker 라이브러리

파일: `old_ver/js/bulkApiWorker.js`  
Campaign 라이브러리명: `lgu:bulkApiWorker`

### 7.1 생성자 설정

| 필드 | 값 | 용도 |
|---|---|---|
| `CLIENT_CODE` | `ibankapacpartnersand` | Target Administration > Implementation 의 client code |
| `BATCH_SIZE` | 5000 (Worker가 덮어씀) | 조회/전송 단위 |
| `SEG_POOL_SIZE` / `SEG_MIN` / `SEG_MAX` | 50 / 10 / 20 | 테스트용 랜덤 `seg_id`. PRD는 실제 세그먼트 연결 필요 |
| `SAVE_SCHEMA` | `lgu:lgu_target_bulk_detail` | UID 단위 로그 |
| `MASTER_SCHEMA` | `lgu:lgu_target_bulk_master` | 배치 단위 로그 |
| `MEMBER_SCHEMA` | `lgu:lgu_member` | 대상 조회 |
| `MEMBER_TABLE` | `lgulgu_member` | `apiYn` SQL 업데이트 테이블명 |
| `bulkApiUrl` | `https://{CLIENT_CODE}.tt.omtrdc.net/m2/{CLIENT_CODE}/v2/profile/batchUpdate` | Bulk API v2 |

### 7.2 run() 배치 루프

```
lastUid 비움
  |
  v
queryMembers(lastUid, BATCH_SIZE)
  |
  +-- 건수 0 --> 워커 종료
  |
  +-- 건수 > 0
        |
        v
      UID별 generateSegId
        |
        v
      callBulkApi
        |
        +-- 성공 --> saveMaster success
        |              --> saveToDb Detail + master FK
        |              --> updateApiYn firstUid~lastUid
        |              --> 커서 lastUid 갱신 --> (다시 queryMembers)
        |
        +-- 실패 --> saveMaster fail
                      |
                      +-- 연속 실패 >= 3 --> throw / 워커 error
                      +-- 미만           --> 커서 lastUid 갱신 --> (다시 queryMembers)
```

커서 규칙:

- 첫 조회: `@membershipUid >= uidStart AND <= uidEnd`
- 이후: `@membershipUid > lastUid AND <= uidEnd`
- `orderBy @membershipUid ASC`, `lineCount = BATCH_SIZE`

`apiYn` 조건은 Worker 조회에 없다. 범위 안의 모든 UID를 다시 읽는다. 전송 여부는 Factory 분배 시점의 스냅샷과 SQL UPDATE에 의존한다.

### 7.3 generateSegId

테스트용이다. `w01` ~ `w50`을 Fisher-Yates로 섞어 10~20개를 고르고 `|`로 연결한다.

예: `w10|w32|w09`

PRD에서는 실제 세그먼트/속성 매핑으로 교체해야 한다. 이 값이 Bulk API의 `seg_id` 컬럼이 된다.

### 7.4 callBulkApi

공식 v2 배치 포맷을 조립한 뒤 POST 한다.

요청 본문:

```
batch=thirdPartyId,seg_id
{uid},{urlEncode(segId)}
{uid},{urlEncode(segId)}
...
```

| 항목 | 값 |
|---|---|
| Method | POST |
| Content-Type | `application/x-www-form-urlencoded` |
| Body | UTF-8 `MemoryBuffer` (바이너리) |
| 식별자 | `thirdPartyId` = `membershipUid` |

재시도:

| HTTP | 동작 |
|---|---|
| 429 | 10초 대기 후 재시도. 최대 3회 |
| 5xx | 5초 대기 후 재시도. 최대 3회 |
| 그 외 4xx | 즉시 throw |
| 2xx | 통신 성공으로 보고 본문 검사 |

비즈니스 성공 조건: 응답 본문에 `<success>true</success>` 포함.

있으면 `<batchStatus>...</batchStatus>`를 잘라 `batchStatusUrl`로 저장한다. 이 URL을 다시 GET 하여 ingestion 완료를 확인하는 코드는 없다. 제출 성공만 성공으로 본다.

연속 배치 실패 3회(`MAX_ERROR`)면 워커를 중단한다. 실패한 배치는 `apiYn`을 올리지 않으므로 다음 라운드 대상이 될 수 있다. 커서는 실패해도 전진한다. 실패한 UID 구간은 이번 워커 실행에서는 재시도하지 않는다.

### 7.5 저장

속성 전체와 신버전 보완 후보는 `9. 스키마`를 본다.

**Master** (`lgu:lgu_target_bulk_master`)

- `_operation = insertOrUpdate`, `_key = @batchName`
- `batchName = {workerName}-{yyyyMMddHHmmss}-{누적건수}`
- 기록 필드: workerName, recordCount, httpCode, success, batchStatusUrl, errorMessage(255자), lastModified
- `createdDate`는 스키마 `GetDate()` default. 코드가 넣지 않음
- 저장 후 `@batchName`으로 `@id`를 다시 조회하여 Detail FK로 사용

**Detail** (`lgu:lgu_target_bulk_detail`)

- `WriteCollection`, `_key = @membershipUid` (스키마 unique와 동일. 재전송 시 덮어씀)
- 기록 필드: membershipUid, segId, lastModified, `master-id`
- 실패 배치에는 Detail을 쓰지 않음

**apiYn**

```sql
UPDATE lgulgu_member
SET sapiyn='Y'
WHERE smembershipuid >= '{firstUid}'
  AND smembershipuid <= '{lastUid}'
  AND (sapiyn='N' OR sapiyn IS NULL)
```

Campaign 스키마 속성명 `@apiYn`과 물리 컬럼 `sapiyn`을 같이 쓴다. 테이블명 규칙은 `{Namespace}{SchemaName}` → `lgulgu_member`.

---

## 8. 상태 변수 사전

Factory `instance.vars`와 Option은 문자열로 비교하는 경우가 많다. 숫자는 `parseInt` 후 사용한다.

### 8.1 instance.vars

| 키 | 생산 | 소비 | 값 |
|---|---|---|---|
| `WORKER_COUNT` | distributor | polling | 5 |
| `TOTAL_LIMIT` | distributor | distributor | 500000 |
| `BATCH_SIZE` | distributor | PostEvent | 5000 |
| `allDone` | distributor | Test | `"true"` / `"false"` |
| `activeWorkers` | distributor | (저장만) | 실제 기동 수 |
| `workerNames` | distributor | (저장만) | `TBAW1,TBAW2,...` |
| `roundSize` | distributor | polling | 이번 라운드 할당 건수 |
| `workersComplete` | polling | Test | `"true"` / `"false"` |
| `globalProcessed` | polling | Test | 누적 처리 건수 |
| `readyRetry_TBAW{n}` | polling | polling | ready 연속 횟수 |

### 8.2 Option

| 키 | 생산 | 소비 |
|---|---|---|
| `WORKER_DONE_TBAW{n}` | distributor=`ready`, worker=`running`/`done`/`error` | polling |

### 8.3 Worker vars (PostEvent)

`uidStart`, `uidEnd`, `workerName`, `batchSize`

---

## 9. 스키마

파일: `old_ver/schema/*.xml`  
네임스페이스: `lgu`  
물리 테이블: `{Namespace}{SchemaName}` 연결. 코드 기준 `MEMBER_TABLE = lgulgu_member`. 로그는 같은 규칙이면 `lgulgu_target_bulk_master`, `lgulgu_target_bulk_detail`.

세 스키마 모두 `autopk="true"`이다. 업무 PK가 아니라 Campaign 자동 `@id`가 PK다.

```
lgu_member (id PK, membershipUid, apiYn)
    |
    |  membershipUid
    v
lgu_target_bulk_detail (id PK, membershipUid UK, segId, master-id FK)
    ^
    |  master-id  (1 Master : N Detail)
    |
lgu_target_bulk_master (id PK, batchName UK, workerName, recordCount,
                        httpCode, success, batchStatusUrl, errorMessage)
```

### 9.1 역할 구분

| 스키마 | 파일 | 역할 | 신버전 |
|---|---|---|---|
| `lgu:lgu_member` | `lgu_member.xml` | 샘플 고객. API 테스트용 추출 원천 | **재사용하지 않음.** 실제 고객 스키마로 교체 |
| `lgu:lgu_target_bulk_master` | `lgu_target_bulk_master.xml` | 배치 1건 = API POST 1회 로그 | 같은 1:N 로그 구조 유지. 속성은 보완 가능 |
| `lgu:lgu_target_bulk_detail` | `lgu_target_bulk_detail.xml` | 배치에 속한 UID 1행 로그 | 같은 구조 유지. 속성은 보완 가능 |

코드가 실제로 읽는 고객 필드는 `@membershipUid`, `@apiYn`뿐이다. `planCode`, `phoneNumber` 등은 테스트 데이터 표현용이며 Bulk 페이로드에 넣지 않는다.

---

### 9.2 `lgu:lgu_member` — 샘플 고객 (테스트 전용)

PRD 고객 정보가 아니다. 전송 대상 조회와 `apiYn` 플래그 테스트를 위해 만든 샘플이다. 신버전 소스는 이 XML을 복사하지 않고, 실제 멤버 스키마의 식별자 + 전송여부 컬럼만 맞추면 된다.

**enumeration**

| name | basetype | 값 |
|---|---|---|
| `mmsConsentEnum` | string | `동의` / `미동의` |

**attribute**

| name | type | length | 설명 | 이 연동에서의 사용 |
|---|---|---|---|---|
| `membershipUid` | string | 10 | 멤버십 고유 식별자 | Bulk `thirdPartyId`. Factory 분배·Worker 커서 키 |
| `mmsConsent` | string | 10 | MMS 수신동의. enum `mmsConsentEnum` | 미사용 |
| `planCode` | string | 20 | 5G 요금제 코드 | 미사용 |
| `planName` | string | 50 | 요금제 명칭 | 미사용 |
| `phoneNumber` | string | 11 | 휴대전화번호 | 미사용. Target 프로필에 넣지 말 것 |
| `optimalSendTime` | string | 5 | 발송 최적 시간 HH:MM | 미사용 |
| `created` | datetime | | 생성 일시 | 미사용 |
| `lastModified` | datetime | | 수정 일시 | 미사용 |
| `apiYn` | string | 1 | 타겟 API 전송여부 | `N`/NULL = 미전송, `Y` = 전송. 테스트용으로 추가됨 |

`membershipUid`에 unique key는 없다. index만 있다. 샘플이라 중복 UID가 들어가면 distinct 조회와 Detail unique가 어긋날 수 있다.

**index**

| name | 컬럼 | 비고 |
|---|---|---|
| `idx_sg_planCode` | `planCode` | 요금제 조회용. 이 연동과 무관 |
| `idx_mt_apiYn_uid` | `apiYn`, `membershipUid` | Factory count / 범위 조회에 맞음 |
| `idx_sg_membershipUid` | `membershipUid` | 커서·UID 경계 조회에 맞음 |

샘플을 버릴 때 실제 소스에 남기면 좋은 최소 계약: **식별자(정렬 가능) + 전송여부 플래그 + (식별자, 플래그) 인덱스**. `apiYn` 길이 1, 값 `Y`/`N`은 관례일 뿐 필수 형식은 아니다.

---

### 9.3 `lgu:lgu_target_bulk_master` — 배치 로그

API POST 1회 = Master 1행. 신버전에서도 배치 단위 로그로 유지한다.

코드 저장: `insertOrUpdate`, `_key = @batchName`.  
`batchName` 예: `TBAW1-20260706120000-5000`.

**enumeration**

| name | basetype | 값 |
|---|---|---|
| `successFlag` | byte | `0` 실패 / `1` 성공 |

**attribute**

| name | type | length / default | 설명 | 코드 기록 |
|---|---|---|---|---|
| `batchName` | string | 100 | 워커명+배치시퀀스. unique index | 기록함 |
| `workerName` | string | 20 | 워커명 `TBAWn` | 기록함 |
| `recordCount` | long | | 해당 POST 행 수 | 기록함 |
| `httpCode` | short | | HTTP 상태. 파싱 실패 시 0 | 기록함 |
| `success` | boolean | enum `successFlag` | 제출 성공 여부. ingestion 완료 아님 | 기록함 |
| `batchStatusUrl` | string | 255 | Target이 준 batchStatus URL | 기록함. 이후 GET 없음 |
| `errorMessage` | string | 255 | 실패 메시지. 코드에서 255자 절단 | 실패 시만 |
| `createdDate` | datetime | `GetDate()` | 최초 insert 시각 | 코드가 직접 안 넣음. default 의존 |
| `lastModified` | datetime | | 수정 시각 | 기록함 |

**index**

| name | 컬럼 | 비고 |
|---|---|---|
| `idx_batchName` unique | `batchName` | insertOrUpdate 키와 일치 |

현재 스키마에 없고, 코드도 안 넣는 것: Target `batchId`, ingestion `status`(complete/incomplete/stuck), `showDetails` 카운트, 배치 UID 범위, 소요 시간.

`batchStatusUrl`을 string 255로 둔 것은 짧다. edge URL + `batchId` + 쿼리가 255를 넘을 수 있다. Campaign string 한도가 255이므로 신버전은 memo를 검토한다.

---

### 9.4 `lgu:lgu_target_bulk_detail` — UID 로그

배치에 속한 식별자 1행. Master link는 Detail 쪽에만 선언한다. `integrity="neutral"` / `revIntegrity="neutral"` — 삭제 시 연쇄 없음. 로그에 맞다.

코드 저장: `WriteCollection`, `insertOrUpdate`, `_key = @membershipUid`, `master-id`.

**attribute / link**

| name | type | length / default | 설명 | 코드 기록 |
|---|---|---|---|---|
| `membershipUid` | string | 10 | 전송한 thirdPartyId | 기록함. unique index |
| `segId` | string | 255 | 파이프 구분 세그 식별자. 미인코딩 원문 | 기록함 |
| `createdDate` | datetime | `GetDate()` | 최초 insert | 코드가 직접 안 넣음 |
| `lastModified` | datetime | | 수정 시각 | 기록함 |
| `master` | link | target `lgu:lgu_target_bulk_master` | FK `@master-id` | 기록함 |

**index**

| name | 컬럼 | 비고 |
|---|---|---|
| `idx_sg_membershipUid` unique | `membershipUid` | 같은 UID는 마지막 전송만 남김. 이력 1건 |

성공한 배치만 Detail을 쓴다. 실패한 배치는 Master만 있고 Detail이 없다.

unique가 `membershipUid`라서 재전송하면 이전 Master 연결이 덮인다. 배치 이력을 UID 단위로 쌓지 않는다.

---

### 9.5 코드가 쓰는 키와 스키마 제약

| 동작 | 스키마 제약 | 영향 |
|---|---|---|
| Detail `_key = @membershipUid` | unique index와 일치 | 재전송 시 행 갱신 |
| Master `_key = @batchName` | unique index와 일치 | 같은 batchName이면 갱신 |
| `membershipUid` length 10 | 샘플 UID 길이 | 실제 `mbox3rdPartyId` 한도는 256. 신버전은 여유 있게 |
| `segId` length 255 | 테스트 `w01\|w02` 수준 | 세그먼트 코드가 길면 절단. memo 검토 |
| `errorMessage` length 255 | Campaign string 한도 | 본문 전체는 못 남김. memo 검토 |
| `batchStatusUrl` length 255 | 위와 같음 | URL 절단 가능. memo 검토 |

조회 스키마: `lgu:lgu_member` (테스트)  
전송 식별자: `membershipUid` → Bulk `thirdPartyId`  
프로필 파라미터: `seg_id` → Target `profile.seg_id`

---

### 9.6 신버전 로그 스키마 — 유지할 것 / 보완 후보

Master 1 : Detail N, 제출 결과 저장, `integrity="neutral"` 은 유지한다. 아래는 없어도 동작하지만, 운영·재처리·공식 batchStatus 폴링을 넣으면 이득인 속성이다. 지금 XML을 바꾸라는 뜻이 아니다.

**Master에 있으면 좋은 속성**

| 후보 | 타입 제안 | 이유 |
|---|---|---|
| `batchId` | string 100 | 응답 URL에서 추출. 상태 조회·지원 요청 키 |
| `ingestStatus` | string + enum (`submitted` / `complete` / `incomplete` / `stuck` / `timeout`) | `<success>true>`와 적재 완료를 분리 |
| `consumedCount` | long | `showDetails=true` |
| `successfulUpdates` | long | 위와 같음 |
| `profilesNotFound` | long | v1에서 의미 있음. v2는 생성하므로 0에 가깝다 |
| `failedUpdates` | long | 부분 실패 감지 |
| `uidStart` / `uidEnd` | string | 실패 배치 재처리 범위 |
| `payloadBytes` | long | 50MB 한도 감시 |
| `attemptCount` | short | HTTP 재시도 횟수 |
| `elapsedMs` | long | 타임아웃·성능 |
| `clientCode` | string 50 | 환경 혼선 방지 |
| `apiVersion` | string 10 | `v1` / `v2` |
| `submittedAt` | datetime | POST 시각. `createdDate`와 별개로 재제출 구분 |
| `ingestCheckedAt` | datetime | 마지막 status 폴링 시각 |
| `responseBody` | memo | 원문. string 255로는 부족 |
| `errorMessage` | memo로 승격 | 현재 255 절단 |
| `batchStatusUrl` | memo로 승격 | URL 절단 방지 |
| `runId` | string | Factory 라운드/워크플로우 인스턴스. 워커 여러 배치를 한 실행으로 묶음 |

**Detail에 있으면 좋은 속성**

| 후보 | 타입 제안 | 이유 |
|---|---|---|
| unique를 `membershipUid + master`로 변경 | 복합키 또는 unique 해제 | 재전송 이력을 남김. 현재는 마지막 1건만 남음 |
| `rowStatus` | string + enum (`sent` / `failed` / `skipped`) | 공식 v2 per-row 상태. 지금은 배치 성공 시에만 insert |
| `httpCode` | short | 배치 실패를 UID 조회에서 바로 보려면 Master 조인 없이 |
| `payloadJson` 또는 추가 컬럼 | memo / string | `seg_id` 외 속성이 늘 때 |
| `membershipUid` length | 64~256 | 공식 `mbox3rdPartyId` 256 |
| `segId` | memo 또는 length 확대 | 세그 코드가 길어질 때 |
| `attemptNo` | short | 같은 UID 재시도 횟수 |
| `sentAt` | datetime | `lastModified`와 분리 |

**의도적으로 넣지 않는 것**

- 전화번호, 동의 여부, 요금제 등 고객 원천 컬럼. 로그 스키마에 복제하지 않는다. 식별자와 전송 페이로드만 남긴다.
- 고객 샘플 스키마(`lgu_member`)의 나머지 속성. 테스트 전용이다.

---

## 10. Factory ↔ Worker 시퀀스

```
Factory                         Option              Worker TBAWn           Target Bulk API v2     Campaign DB
   |                              |                      |                        |                    |
   |-- count apiYn N -------------+----------------------+------------------------+------------------->|
   |-- UID 경계 조회 -------------+----------------------+------------------------+------------------->|
   |-- WORKER_DONE_TBAWn = ready >|                      |                        |                    |
   |-- PostEvent signalTBAWn -----+--------------------->|                        |                    |
   |   uidStart, uidEnd           |                      |                        |                    |
   |-- 1분 대기                   |                      |                        |                    |
   |                              |<-- running ----------|                        |                    |
   |                              |                      |                        |                    |
   |                              |                      |  (배치 루프)            |                    |
   |                              |                      |-- queryMembers 커서 ---+------------------->|
   |                              |                      |-- POST batch=thirdPartyId,seg_id ---------->|
   |                              |                      |<-- success / batchStatus -------------------|
   |                              |                      |-- master + detail -----+------------------->|
   |                              |                      |-- apiYn = Y -----------+------------------->|
   |                              |                      |  (루프 끝)              |                    |
   |                              |                      |                        |                    |
   |                              |<-- done 또는 error --|                        |                    |
   |                              |                      |                        |                    |
   |-- getOption 전부 ----------->|                      |                        |                    |
   |                              |                      |                        |                    |
   +-- 미완료 --> workersComplete = false / 1분 후 재폴링
   +-- 전원 done --> globalProcessed += roundSize --> Test Next Work 또는 Finish
```

---

## 11. Adobe Campaign 기술 레퍼런스 (확인 완료)

| 항목 | 결론 |
|---|---|
| `HttpClientRequest` → `response.code` | 공식 지원. integer (200, 429, 500 등) |
| `response.header` (예: `Retry-After`) | 버전별 불안정. 고정 대기 fallback 권장 |
| string 속성 최대 길이 | 255. 초과 시 memo |
| `GetDate()` | XTK 표현식. PostgreSQL에서 `NOW()`로 변환 |
| link 선언 | FK를 가진 쪽(N/Detail)에서만 선언. Master 역방향 link는 자동 생성 |
| FK 세팅 | `el.setAttribute("master-id", masterId)` |
| `integrity="neutral"` | 삭제 시 동작 없음. 로그 테이블에 적합 |
| enum 스키마 | `<enumeration>` + `<attribute enum="..."/>` |
| DB 테이블명 | `{Namespace}{SchemaName}` 예: `lgulgu_member` |

---

## 12. 코드에서 읽히는 제약 / 재구현 시 주의

1. Target 제출 성공(`<success>true</success>`)과 ingestion 완료(`batchStatus = complete`)는 다르다. 현재는 제출만 확인한다.
2. `seg_id`는 랜덤이다. PRD 매핑이 아니다.
3. Test의 `100000`과 `TOTAL_LIMIT 500000`이 불일치한다.
4. polling은 skip 워커와 이전 라운드 Option 잔존에 취약하다.
5. 배치 실패 후에도 커서는 전진한다. 실패 구간은 같은 run에서 재전송하지 않는다.
6. `updateApiYn`은 문자열 결합 SQL이다. UID에 따옴표가 있으면 깨진다.
7. Worker 조회에 `apiYn` 필터가 없다.
8. Bulk API 공식 한도(파일 50MB, 행 500,000, 분당 50회)는 코드에 가드가 없다. `BATCH_SIZE=5000` × 워커 5는 동시 제출 시 rate limit에 걸릴 수 있다.

공식 API 제약과 재구성 체크리스트는 `docs/main`의 Profile API 연동 설명서를 본다. 이 문서는 `old_ver` 동작만 고정한다.
