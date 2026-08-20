# new_ver Logic

Adobe Campaign Classic Factory가 미전송 회원(`apiYn = N`)을 UID 구간으로 나누고, Worker가 Adobe Target Bulk Profile Update API v2로 배치 전송한다.

이 문서는 `new_ver`의 현재 스냅샷이다. **기준 구현은 라이브러리와 스키마**다. Factory / Worker 진입 / Smoke는 프로토타입이며, 다음 Phase에서 라이브러리 계약에 맞춰 다시 짜거나 삭제한다.

공식 계약·조회 API는 `docs/main/01_ProfileApiDataIntegration.md`를 본다. 이 문서는 Campaign 쪽 실행 구조만 고정한다.

---

## 1. 성숙도

| 경로 | 역할 | 상태 |
|---|---|---|
| `js/testWooBulkApiWorker.js` | 전송·로그·apiYn. 워커 N개가 `loadLibrary`로 공유 | 기준 구현. 검수 보완(인증·escape·짧은 batchStatus·runId) 반영 |
| `schema/*.xml` | 샘플 원천 + Master/Detail 로그 | 리팩토링 완료. Sample은 확정. Master 중복 속성만 검수에서 제거 |
| `workflow/factory/*` | 분배·폴링·설정 | 스모크 계약으로 재작성. 워커 5→15 |
| `workflow/worker/worker.js` | Signal → 라이브러리 실행 | `{runId}|status` 또는 `{runId}|done|sent|failed` |
| `test/*` | Smoke 워크플로우 | 5차 FAIL=0 통과. 라이브러리 계약 검증 완료 |

다음: Campaign에 TBAWFactory + TBAW1..5 를 올리고 2.5만 건으로 첫 실전송. 워커는 15까지 늘린다.

---

## 2. 한 줄 요약

```
00_Config
  → 01_WorkerDistributor (UID 구간 분할 + PostEvent)
  → 02_Polling (Option 상태)
  → 03_Test
       |-- Working... → 1m Wait → 02_Polling
       |-- Next Work  → 01_WorkerDistributor
       +-- Finish     → End

Worker: signalTBAWn → loadLibrary → BulkApiWorker.run
  → 조회(apiYn=N, 커서) → CSV POST → Master → Detail → apiYn=Y
```

Factory와 Worker는 같은 프로세스가 아니다. Factory는 이벤트만 보내고, 완료는 Option으로만 본다.

---

## 3. 구성 요소

```
new_ver/
  js/testWooBulkApiWorker.js              라이브러리 wootar:testWooBulkApiWorker[.js]
  schema/testWooTargetSample.xml          샘플 고객. 확정. PRD 소스 아님
  schema/testWooTargetBulkApiMaster.xml   배치 1건 로그
  schema/testWooTargetBulkApiDetail.xml   UID 1건 로그. Master 1:N
  workflow/factory/00_Config.js           FACTORY_CFG + BULK_CFG. 설정 Option 없음
  workflow/factory/01_WorkerDistributor.js UID 분할 + PostEvent (스모크 계약)
  workflow/factory/02_Polling.js          {runId}|status[|sent|failed]
  workflow/worker/worker.js               TBAW1..15 동일. 07과 같은 진입 + sent 보고
  test/01_SmokeConfig.js ~ 07_...         스모크. 5차 FAIL=0
```

| 역할 | Campaign | 코드 | 통신 |
|---|---|---|---|
| Factory | 메인 WF | 00 / 01 / 02 + Test | `PostEvent`, `setOption` / `getOption` |
| Worker | TBAW1..N | worker.js + 라이브러리 | Signal vars → Option 상태 |
| Smoke | TBAWSmoke + TBAWSmokeSignal | test/* | 동일 라이브러리, dryRun / 실호출 스위치 |

---

## 4. Factory 흐름

워크플로우 (화면 기준):

```
Start
  --> 00_Config                 Ok
  --> 01_Worker Distributor
  --> 02_Polling
  --> 03_Test
        |-- Working... --> 1m Wait --> 02_Polling
        |-- Next Work  --> 01_Worker Distributor
        +-- Finish     --> End
```

`03_Test`는 `instance.vars.nextAction`을 본다. old_ver의 `workersComplete` / `allDone` / 하드코드 `100000` 조합을 대체한다.

| nextAction | 의미 |
|---|---|
| `working` | 워커 미완료. 1분 후 재폴링 |
| `next` | 라운드 완료. 다음 분배 |
| `finish` | 대상 없음 / 상한 / 워커 0 |

### 4.1 00_Config

설정은 `FACTORY_CFG` + `loadLibrary` 후 `BULK_CFG`. getOption으로 설정을 읽지 않는다.

조절 지점: `WORKER_COUNT`(5~15), `ROUND_LIMIT`, `GRAND_TOTAL`(이번 실행 5000000).

스키마·배치 크기·CUSTOM_ATTR은 `BULK_CFG`. Option 키는 `WORKER_DONE_TBAWn`.

### 4.2 01_WorkerDistributor

스모크 03_Fire와 같은 PostEvent 계약. 분할은 pending `@membershipUid` 오름차순 offset. prefix/자릿수 없음.

1. pending 첫 UID (`orderBy @membershipUid` startLine=0). 없으면 `finish`.
2. `ROUND_LIMIT`와 `GRAND_TOTAL` 잔여로 이번 라운드 행 수 remaining.
3. `EXACT=true`면 count. 아니면 remaining = limit (앞 N건).
4. `runId = yyyyMMddHHmmss + R + round`.
5. offset 분할: 정렬 목록에서 워커 수만큼 경계 UID 조회. 닫힌 구간. UID-1 산술 없음.
6. 워커별 Option: `{runId}|ready` 또는 `{runId}|skip`.
7. PostEvent vars: `runId`, `workerName`, `uidStart`, `uidEnd`, `batchSize`, `optKey`, `dryRun=false`, `workerCount`(실발사 수), `customAttr`, `authToken`.
8. 할당 0이거나 워커 WF가 시작됨(11)이 아니면 `skip`. 전원 미발사이면 `finish`.
9. PostEvent 사이 `STAGGER_POST` ms.

skip 워커도 Option을 남긴다. 이전 라운드 `done` 잔존으로 폴링이 끝나는 구멍을 막는다.

워커·라이브러리 조회도 `@membershipUid` 오름차순이라 CSV 행 순서가 UID 순이다.

워커 WF `TBAWn`이 없으면 skip 로그. 늘릴 때 WF를 먼저 Start 한다.

### 4.3 02_Polling

Option 값: `{runId}|{status}` 또는 `{runId}|done|{sent}|{failed}`.

| status | 동작 |
|---|---|
| `done` / `skip` | 완료 |
| `error` | 목록에 추가. `ABORT_ON_WORKER_ERROR`면 throw, 아니면 제외하고 진행 |
| `ready` | 시그널 미수신. `MAX_READY_POLL` 초과면 error |
| 그 외 (`running`) | pending |
| Option의 runId ≠ 이번 runId (`STRICT`) | stale. pending |

라운드 타임아웃: `pollCount >= MAX_RUN_POLL`.

전원 완료면 `globalProcessed +=` 워커가 보고한 `sent` 합. GrandTotal 도달 시 `finish`, 아니면 `next`. 상한은 추정 span이 아니라 실제 전송 건수다.

### 4.4 동시 워커

워커 WF는 프로세스마다 `this`가 따로 있다. `BULK_CFG`는 읽기 전용.

| 공유 자원 | 안전 장치 |
|---|---|
| Sample 행 | pending 을 UID 오름차순 offset 으로 닫힌 구간. 조회 `>=start <=end`, 커서는 `> lastUid` |
| apiYn UPDATE | 배치 first~last. 구간이 안 겹치면 행 경합 없음 |
| Master | `batchName = {workerName}-{runId}-{batchNo}` unique |
| Detail | `_key=@membershipUid`. 구간 비중첩이면 같은 UID를 두 워커가 안 씀 |
| Option | 워커당 `WORKER_DONE_TBAWn` 1키 |
| Target 50콜/분 | `workerCount`로 스로틀. 첫 POST는 `STAGGER_SLOT_MS × (n-1)`. Factory PostEvent도 300ms 간격 |

워커를 늘릴 때: TBAWn 을 Start → `FACTORY_CFG.WORKER_COUNT`를 같은 수로. 15 초과는 양쪽에서 클램프.

---

## 5. Worker 진입 (스모크와 동일 계약)

`test/07_SmokeSignalWorker.js` 와 `workflow/worker/worker.js` 가 같다.

```
signalTBAWn
  --> worker.js
        loadLibrary("wootar:testWooBulkApiWorker.js")
        report(runId + "|running")
        new BulkApiWorker(vars).run()
        report(runId + "|done" | runId + "|error")
  --> End
```

예외는 rethrow하지 않는다. 워커 WF가 Error로 멈추면 다음 PostEvent가 큐에만 쌓인다.

```
setOption(optKey, runId + "|" + status)
  // done 이면 runId|done|sent|failed
new BulkApiWorker(vars)
  // workerName, uidStart, uidEnd, batchSize, runId,
  // dryRun, workerCount, authToken, customAttr, optKey
```

설정은 Option이 아니다. 토큰·CUSTOM_ATTR·스키마는 `BULK_CFG` 또는 시그널. Option은 상태 핸드셰이크만.

라이브러리명은 Campaign에 등록된 내부명을 그대로 쓴다. `.js` 포함 여부는 콘솔에서 확인한다.

---

## 6. 라이브러리 계약 (기준 구현)

파일: `new_ver/js/testWooBulkApiWorker.js`  
전역 설정: `BULK_CFG` (흔한 `CFG`와 충돌 방지)  
생성자: `new BulkApiWorker(p)` — p는 Signal `vars`.

### 6.1 입력

| 필드 | 필수 | 기본 | 의미 |
|---|---|---|---|
| `workerName` | 권장 | `W0` | 로그·batchName |
| `uidStart` / `uidEnd` | 필수 | 빈 값이면 throw | 닫힌 UID 구간 |
| `batchSize` | 선택 | 5000. 상한 500000 | 조회/전송 행 |
| `runId` | 선택 | 워커 시각 | 전 워커 동일해야 회차 조회 가능 |
| `dryRun` | 선택 | false | `"true"`면 POST·apiYn 생략. 조회/CSV/로그는 수행 |
| `workerCount` | 선택 | 5. 1 미만이면 1 | 스로틀 계산 |
| `authToken` | 선택 | 빈 값 | Profile API 토큰(Bearer). 없으면 `BULK_CFG.AUTH_TOKEN`. Debugger tools 토큰 아님. 둘 다 비면 헤더 생략 |
| `customAttr` | 선택 | 빈 값 | 추가 컬럼. 없으면 `BULK_CFG.CUSTOM_ATTR` |

### 6.2 run() 순서

```
lastUid 비움
  |
  v
queryMembers  (apiYn N 또는 NULL AND UID 커서)
  |
  +-- 0건 --> 종료 { sent, failed, batches }
  |
  +-- N건 --> generateSegId (더미 w01..w50, 255 절단)
                --> callBulkApi
                      |-- 성공 --> pollBatchStatus(짧은 GET)
                      |            --> saveMaster --> saveToDb --> updateApiYn
                      +-- 실패 --> saveMaster(fail). Detail/apiYn 없음
                --> lastUid = 배치 끝 UID (성공/실패 공통)
                --> 연속 실패 MAX_ERROR(3)면 throw
```

커서를 실패 후에도 미는 이유: 같은 구간을 무한 재시도하지 않기 위함. 실패 행은 `apiYn='N'`이라 다음 라운드에서 다시 집힌다.

### 6.3 조회

- `@apiYn = 'N' OR @apiYn IS NULL`. 갱신 SQL과 동일.
- `distinct` 없음. Sample `membershipUid` unique 전제.
- 첫 조회: `>= uidStart`. 이후: `> lastUid`. 항상 `<= uidEnd`.
- UID는 `sqlLit`으로 `'` → `''` 치환 후 조건에 넣는다.
- `CUSTOM_ATTR`이 있으면 해당 `@속성명`을 select에 붙인다. 스키마에 없는 이름은 queryDef 예외.

### 6.4 전송

```
POST https://{CLIENT_CODE}.tt.omtrdc.net/m2/{CLIENT_CODE}/v2/profile/batchUpdate
Content-Type: application/x-www-form-urlencoded
Body: MemoryBuffer(utf-8)

batch=thirdPartyId,seg_id[,planName,phoneNumber,...]
{encodeURIComponent(uid)},{encodeURIComponent(segId)}[,encoded extra...]
```

- 배열 `join("\n")`. SpiderMonkey에서 `+=` 누적의 O(n²)를 피함.
- 50MB 가드 (`payload.length`, 인코딩 후 ASCII 전제).
- 성공: HTTP 2xx **그리고** 본문에 `<success>true</success>`.
- `<batchStatus>` URL을 받은 뒤 `POLL_MAX`(2)회 GET `showDetails=true`. complete/stuck이면 중단. incomplete는 Master에 남김. 조회 실패는 제출 성공을 뒤집지 않음.
- 토큰이 있으면 POST/GET 모두 `Authorization: Bearer`. 없으면 헤더 생략.
- 추가 컬럼은 Target에서 `profile.{속성명}`이 된다. 빈 칸은 기존 프로필을 지우지 않는다(공식).
- DRY_RUN 로그는 CSV 헤더만. 본문(전화번호 등)은 찍지 않는다.

재시도 (`MAX_RETRY` 3). 공식 `sleep(ms)`:

| HTTP | 대기 |
|---|---|
| 429 | 10000 ms (프록시/APIM) |
| 503 | 65000 ms (계정 분당 50콜. 한도 창이 분 단위) |
| 그 외 5xx | 5000 ms |
| 그 외 4xx | 즉시 throw |

스로틀: 계정 50콜/분 × 안전 0.7 / 워커 수. 워커 5면 약 8572 ms. 재시도·batchStatus GET 포함 매 HTTP 직전. 조회·저장이 더 길면 대기 없음.

### 6.5 저장

Master: `insertOrUpdate` `_key=@batchName`.  
`batchName = {workerName}-{runId}-{batchNo}`.  
항상 기록: workerName, runId, recordCount, httpCode, success(1/0), attemptCount, elapsedMs, batchStatusUrl(255 절단), errorMessage(255 절단), lastModified.  
짧은 조회를 했을 때만: batchStatus, consumedCount, successfulUpdates, failedUpdates, profilesNotFound, statusCheckedDate.  
autopk는 batchName으로 `get` 재조회 (`sqlLit`).

Detail: 성공 배치만. `WriteCollection`, `_key=@membershipUid`, `master-id`. masterId 0이면 생략(고아 방지).

apiYn: 구간 UPDATE. DRY_RUN이면 생략. SQL은 `N OR NULL`도 갱신(구 데이터 방어).

### 6.6 더미 세그먼트

`generateSegId`는 테스트용. 운영에서는 **이 함수 본문만** 교체한다. 반환은 파이프 연결 문자열 1개. `clipSegId`가 255에서 자른다. CSV와 Detail 모두 절단값을 쓴다.

### 6.7 CUSTOM_ATTR — 가변 프로필 컬럼

기본 전송은 항상 `thirdPartyId` + `seg_id`다. 샘플 스키마의 다른 속성(요금제, 전화, 동의, 발송시간 등)을 같이 보내려면 설정을 켠다.

우선순위: 시그널 `customAttr` → `BULK_CFG.CUSTOM_ATTR`. xtk:option은 쓰지 않는다.

허용 형식:

```
@planName, @phoneNumber
["@planName","@phoneNumber"]
planName,phoneNumber
```

파싱 규칙:

- `@` / 따옴표 / 대괄호는 벗긴다.
- 식별자만 허용 (`[A-Za-z_][A-Za-z0-9_]*`). 아니면 throw.
- 예약 제외: `membershipUid`, `apiYn`, `segId`/`seg_id`, `thirdPartyId`.
- 대소문자만 다른 중복은 첫 이름만. Target 헤더는 스키마 속성명 그대로(대소문자 구분 → `profile.planName`).
- 값은 `EXTRA_VAL_MAX`(256)에서 절단. in-mbox profile 한도에 맞춤.

용도: Target이 thirdPartyId 기준으로 `profile.*`를 갱신한다. 캠페인에 필요한 속성을 일배치로 올리고, 오디언스에서 그 속성으로 타겟을 고를 수 있다. Detail에는 남기지 않는다(전송 전용).

샘플에서 쓰기 좋은 이름: `mConsent`, `planCode`, `planName`, `phoneNumber`, `optimalSendTime`. `created` / `lastModified`는 넣지 않는 편이 낫다.

---

## 7. old_ver 대비 라이브러리에서 좋아진 점

| 항목 | old_ver | new_ver |
|---|---|---|
| 설정 충돌 | 생성자 필드 분산 | `BULK_CFG` 접두어 |
| 파라미터 | 위치 인자 3개 | Signal 객체. dryRun / runId / workerCount |
| Worker 조회 | apiYn 필터 없음 | `@apiYn = 'N'` |
| distinct | 사용 (대량에서 비쌈) | 제거. unique 전제 |
| CSV 조립 | `+=` | 배열 join |
| 파일 한도 | 없음 | 50MB throw |
| 분당 50콜 | 없음. 503을 일반 5xx(5초)로 처리 | 스로틀 + 503은 65초 |
| sleep 단위 | `sleep(10)` = 10ms. 주석은 10초 | ms 상수. 공식 `sleep(delay)`는 milliseconds |
| 429 vs 503 | 429만 구분 | 429 / 503 / 기타 5xx 분리 |
| MemoryBuffer | 재시도마다 재사용은 했으나 주석 없음 | 루프 밖 1회. body 재사용 문서화 |
| 실패 커서 | 전진. 같은 run에서 재시도 없음 | 동일. 다음 라운드 재처리로 명시 |
| skip 워커 | Option 미기록 → 폴링 무한 | Factory가 `skip` 기록 (PT) |
| Test 분기 공백 | 100000 vs TOTAL_LIMIT | `nextAction` + GrandTotal (PT) |
| 라운드 식별 | 없음 | `runId` (Option·batchName) |
| 관측 | httpCode, success | + attemptCount, elapsedMs |
| Dry run | 없음 | 전송/플래그만 생략 |
| Detail 고아 | masterId 실패해도 저장 시도 | masterId 0이면 생략 |
| 연속 실패 Master | 실패 시 기록 예외면 워커 중단 | 실패 Master는 내부 try. 루프 유지 |
| 워커 WF 에러 | throw 시 WF 정지 | 진입점이 삼킴 (PT, 의도는 맞음) |

---

## 8. 라이브러리 검수

Adobe Campaign 워크플로우 JS는 SpiderMonkey + E4X다. `let` / `const` / 화살표 / `Array.map` / `forEach` / 템플릿 리터럴은 쓰지 않았다. `for each`, E4X XML, `var`, `parseInt(x, 10)`는 ACC에서 실행 가능한 형태다.

`sleep`은 공식 문서상 **milliseconds**. 스로틀·429/503 대기는 이 전제가 맞다.

### 8.1 기능 — 지금 상태로 동작하는 것

- UID 구간 + 커서 + BATCH_SIZE 분할 전송
- 공식 v2 CSV (`batch=thirdPartyId,seg_id[,CUSTOM_ATTR...]`, form-urlencoded, binary body)
- HTTP / `<success>true>` 2단 판정
- 429 / 503 / 5xx 재시도, 4xx 즉시 실패
- 계정 분당 50콜 방어
- Master/Detail + apiYn
- DRY_RUN
- 연속 3 배치 실패 시 워커 중단
- Bearer 선택 적용 (시그널 / `BULK_CFG.AUTH_TOKEN`)
- UID `sqlLit`, apiYn N/NULL 조회, segId 255 절단, UID URL-encode
- POST 직후 batchStatus 짧은 GET → Master 적재 컬럼
- Master.`runId`
- CUSTOM_ATTR 가변 컬럼 (조회 select + CSV 헤더/행). 기본은 uid+seg_id

### 8.2 기능 — 남은 공백

1. **적재 완료를 워커가 보장하지 않음.** `POLL_MAX=2`는 스냅샷이다. incomplete는 후속 잡이 재조회해야 한다.
2. **`loadLibrary` 이름.** 코드는 `wootar:testWooBulkApiWorker.js`. 콘솔 내부명에 `.js`가 없으면 로드 실패다. Factory/Worker Phase에서 맞춘다.
3. **Factory는 스모크 계약으로 재작성됨.** PostEvent에 dryRun/workerCount/customAttr/authToken. 폴링은 sent 합. TBAW1..n 캔버스는 Campaign에 올려야 한다.
4. **동기 HttpClientRequest 타임아웃.** 공식 `execute`의 timeout은 비동기 전용. 동기 기본 대기는 약 5분. async로 바꾸지 않음.
5. **토큰 회전.** 재발급 시 `BULK_CFG.AUTH_TOKEN`(또는 시그널 `authToken`)만 바꾼다. 값은 로그에 안 남긴다.

### 8.3 효율 — 다음 Phase (라이브러리 밖)

- `saveMaster` 재조회 1회/배치는 유지. 부담은 주석대로 작다.
- 스로틀은 워커 로컬이다. 계정 한도는 전역. 503 65초가 안전망.
- Factory가 실제 `sent`를 쓰려면 진입점이 `run()` 반환값을 Option에 써야 한다.

쓰지 말 것: `Promise`, `JSON.stringify` 의존, `const`/`let`, `forEach`, 템플릿 리터럴, optional chaining.

---

## 9. 스키마 검수

네임스페이스 `wootar`. 물리 테이블은 `{Namespace}{SchemaName}` 캐멀 연결. 코드: `WootarTestWooTargetSample`. Smoke는 `wootartestwootargetbulkapimaster`로 컬럼 존재를 확인한다.

### 9.1 `testWooTargetSample` — 확정. 수정 없음

테스트 원천이다. PRD 고객 스키마로 쓰지 않는다.

연동이 항상 쓰는 것: `membershipUid`(unique key, notNull, len 10), `apiYn`(enum N/Y, notNull, sqlDefault N), `idx_mt_apiYn_uid`.

나머지(mConsent, planCode, planName, phoneNumber, optimalSendTime)는 `CUSTOM_ATTR`에 넣으면 같이 전송한다. `created` / `lastModified` / `idx_sg_planCode`는 샘플 표현용. 스키마는 확정이므로 수정하지 않는다.

라이브러리 전제와 맞음: unique UID → distinct 불필요. 조회는 N 또는 NULL.

### 9.2 `testWooTargetBulkApiMaster`

워커가 쓰는 필드만으로도 제출 로그는 성립한다.

| 필드 | 타입 | 워커 | 판단 |
|---|---|---|---|
| `batchName` | string 100 UK | 기록 | 유지. insertOrUpdate 키 |
| `workerName` | string 20 | 기록 | 유지 |
| `runId` | string 40 | 기록 | 유지. `idx_runId` |
| `recordCount` | long | 기록 | 유지 |
| `attemptCount` | byte | 기록 | 유지. **파일에 두 번 선언되어 있었음. 검수에서 1개만 남김** |
| `elapsedMs` | long | 기록 | 유지. 중복 선언 제거 |
| `httpCode` | short | 기록 | 유지 |
| `success` | byte + enum | 기록 1/0 | 유지. old_ver boolean과 달리 enum basetype과 일치 |
| `errorMessage` | memo | 기록 (코드는 255자 절단) | 유지. 본문 보관용 memo는 맞음 |
| `batchStatusUrl` | string 255 | 기록 (절단) | 유지. URL이 255를 넘으면 잘림. memo 승격은 운영에서 실측 후 |
| `createdDate` | datetime default | 코드 미기록 | 유지. DB default |
| `lastModified` | datetime | 기록 | 유지 |
| `batchStatus` | string enum | 짧은 GET 성공 시 | complete/incomplete/stuck |
| `consumedCount` | long | 동일 | showDetails |
| `successfulUpdates` | long | 동일 | showDetails |
| `failedUpdates` | long | 동일 | showDetails |
| `profilesNotFound` | long | 동일 | showDetails |
| `statusCheckedDate` | datetime | 동일 | 마지막 조회 시각 |

인덱스: `idx_batchName` 필수. `idx_runId` 회차 조회. `idx_success_status`는 incomplete 재조회용.

`runId` 컬럼과 `idx_runId`는 라이브러리가 기록한다. 회차 조회용.

**지금 넣지 말 것:** clientCode, apiVersion, payloadBytes, uidStart/uidEnd, responseBody, payloadJson. 로그가 고객 원천을 복제할 필요도 없다.

`batchStatus` 일족은 워커의 짧은 GET이 채운다. incomplete 재조회 잡은 다음 Phase에서 Factory 쪽에 둘 수 있다.

### 9.3 `testWooTargetBulkApiDetail`

| 필드 | 워커 | 판단 |
|---|---|---|
| `membershipUid` unique | 기록 | 유지. 재전송 시 마지막 1건만 남음 |
| `segId` 255 | 기록 (절단) | 유지 |
| `createdDate` default | 미기록 | 유지 |
| `lastModified` | 기록 | 유지 |
| `master` link neutral | `master-id` | 유지. 로그에 맞음 |

더 넣지 않는다. CUSTOM_ATTR 값도 Detail에 복제하지 않는다. `rowStatus`, `payloadJson`, 복합 unique는 이력·부분실패를 남길 때다. 지금 규칙은 “성공 배치만 Detail, UID당 1행”이다.

unique=`membershipUid`를 `membershipUid + master`로 바꾸면 이력이 쌓이지만 라이브러리 `_key`도 같이 바꿔야 한다. 다음 Phase 결정.

### 9.4 관계

```
testWooTargetSample (membershipUid UK, apiYn)
        |
        |  업무 키만 공유. FK 아님
        v
testWooTargetBulkApiDetail (membershipUid UK, segId)
        ^
        |  master-id  (1 Master : N Detail)
        |
testWooTargetBulkApiMaster (batchName UK)
```

---

## 10. Smoke 흐름 (캔버스는 유지, 역할만 구분)

설정은 `01` 상단 스위치 + `BULK_CFG`. 활동 이름·선은 기존과 같다.

```
Start
  --> 01_Config         BULK_CFG 검사. SMOKE_REAL_ROWS=2
  --> 02_Local          스키마 I/O, 분할, 같은 캔버스 dryRun (미전송)
  --> 03_Fire           pending 2건 PostEvent. dryRun=false
  --> 30s Wait
  --> 04_Poll           {runId}|status  (제출 완료. 적재 완료 아님)
  --> Test
        |-- Working --> 30s Wait --> 04_Poll
        |-- False   --> End Error
        +-- Done
              --> 05_ApiTest     Master batchStatus + Profile Fetch 1건
              --> 1m Wait        적재 여유
              --> 06_Verify      apiYn=Y, Fetch 재시도, 로그 삭제
              --> End
```

별도 WF `TBAWSmokeSignal`: 항상 시작됨. `07` = `worker.js`와 같은 진입점. **여기서 샘플 UID를 샌드박스 Target에 실전송한다.**

| 활동 | 하는 일 | 안 하는 일 |
|---|---|---|
| 02 | 로컬 계약, dryRun Master(`DRYRUN`) | Target POST |
| 03+07 | 라이브러리 실전송 2건 | 300건, 가짜 SMOKE_TEST_A/B |
| 04 | 워커 프로세스 종료 | ingest complete 보장 |
| 05 | 실전송 Master URL GET, Fetch 1 UID, Postman URL 로그 | 새 가짜 프로필 생성 |
| 06 | apiYn=Y, Fetch 재시도 | Fetch 404를 FAIL로 두지 않음 |

Fetch 404는 공식 적재 지연(최대 24시간)일 수 있다. 제출 성공은 Master `httpCode=200` + `batchStatusUrl`이 `http`로 시작. Target 값은 Postman GET `.../profiles/thirdPartyId/{uid}?client={CLIENT_CODE}` 로 확인.

통과 기준: FAIL=0. 그다음 Factory `00`/`01`/`02`를 이 시그널 계약으로 재작성한다.

---

## 11. Phase 1~3 보고 / 다음 Phase

완료한 것:

1. 이 문서에 Factory / Worker / 라이브러리 / 스키마 / Smoke 큰 흐름을 모았다.
2. 라이브러리 검수 보완을 반영했다. 인증, UID escape, apiYn NULL, segId 절단, 짧은 batchStatus GET, runId 저장, CUSTOM_ATTR 가변 컬럼.
3. Master에 `runId` + `idx_runId`를 추가했다. Sample은 불변.

다음 Phase에서 할 일:

- Campaign에 TBAWFactory + TBAW1..5 를 올리고 GRAND_TOTAL=5000000 으로 첫 실전송
- 워커를 6..15로 늘리며 라운드 소요를 맞춘다. WORKER_COUNT와 Start된 WF 수를 같게
- incomplete Master 재조회 잡 (선택)
- Campaign 콘솔에서 라이브러리 내부명(`.js` 여부) 확인 후 `loadLibrary` 맞추기
