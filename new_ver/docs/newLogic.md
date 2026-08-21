# new_ver Logic

Adobe Campaign Classic Factory가 미전송 회원(`apiYn = N`)을 **적재 큐 키**로 나누고, Worker가 Adobe Target Bulk Profile Update API v2로 배치 전송한다.

이 문서는 `new_ver`의 현재 스냅샷이다. **기준 구현은 라이브러리와 스키마**다.

공식 계약·조회 API는 `docs/main/01_ProfileApiDataIntegration.md`를 본다. 이 문서는 Campaign 쪽 실행 구조만 고정한다.

---

## 1. Phase

공유 자원(스키마·라이브러리)을 먼저 고정한다. 패키지는 한 phase에 하나만 손본다.

| Phase | 대상 | 상태 |
|---|---|---|
| A | `schema/*`, `js/testWooBulkApiWorker.js`, `test/*` | 완료. 스모크 2026-08-21 PASS=50 FAIL=0 |
| B (현재) | `workflow/factory/*`, `workflow/worker/worker.js` | 같은 큐 키·시그널 계약으로 구현 |

| 경로 | 역할 |
|---|---|
| `js/testWooBulkApiWorker.js` | 전송·로그·apiYn. 워커 N개가 `loadLibrary`로 공유 |
| `schema/testWooTargetSample.xml` | 샘플 원천. 전송 큐. PRD 고객 스키마 아님 |
| `schema/testWooTargetBulkApiMaster.xml` | 배치 1건 로그 |
| `schema/testWooTargetBulkApiDetail.xml` | UID 1건 로그. Master 1:N |
| `test/*` | Smoke. 라이브러리 계약 검증. 스모크 통과 후 손대지 않음 |
| `workflow/factory` | Factory 00/01/02 + 워커 진입 |
| `workflow/status` | 적재 GET. `docs/statusLogic.md` |

---

## 2. 한 줄 요약

```
Sample = 전송 큐
  업무 키: membershipUid  (Target thirdPartyId. 구간·정렬에 쓰지 않음)
  큐 키:   ingestYm + lineNo  (적재월 + 월내 일련. 분할·조회·apiYn 갱신)

00_Config
  → 01_WorkerDistributor (같은 ingestYm 안 lineNo 구간 + PostEvent)
  → 02_Polling (Option 상태)
  → 03_Test
       |-- working → 1m Wait → 02_Polling
       |-- next    → 01_WorkerDistributor
       +-- finish  → End

Worker: signal → loadLibrary → BulkApiWorker.run
  → 조회(apiYn=N, 큐 커서) → CSV POST → Master(URL) → Detail → apiYn=Y
TBAWStatus (전송 1~2시간 후): Master URL GET → complete|stuck|incomplete
```

Factory와 Worker는 같은 프로세스가 아니다. Factory는 이벤트만 보내고, 완료는 Option으로만 본다.

---

## 3. 큐 키 전략

### 3.1 왜 큐 키가 필요한가

`membershipUid`는 고객 식별자다. PRD 값은 순서를 보장하지 않는다. 워커 구간을 UID 문자열 비교로 나누면 적재 순서와 어긋난다.

Sample은 고객 마스터가 아니라 **보내기 전에 쌓는 전송 큐**다.

| 필드 | 역할 |
|---|---|
| `membershipUid` | Target `thirdPartyId`. **유니크 아님**. 날짜·세그마다 여러 행 |
| `ingestYm` | 적재월 `YYYYMM`. 한 라운드는 한 월만 처리 |
| `lineNo` | 그달 insert 일련. 1부터. 월마다 리셋 |
| `apiYn` | N=대기, Y=제출 성공 |

유니크는 `(ingestYm, lineNo)` 만. 어제 Seg 1,3,5 / 오늘 Seg 2,4 처럼 같은 UID가 두 줄이 된다.

정렬·분할·워커 `BETWEEN`·배치 커서·`apiYn` UPDATE는 전부 `@ingestYm` + `@lineNo` 만 쓴다.

### 3.2 long 상한

ACC `long`은 부호 있는 32비트(최대 2,147,483,647)다. 월 1억 건을 무한 누적하면 약 21개월에 insert가 실패한다.

대응은 타입을 키우는 것이 아니라 **번호를 월 단위로 끊고, 보낸 행을 지우는 것**이다.

| 규칙 | 내용 |
|---|---|
| 월 리셋 | 새 `ingestYm`이 시작되면 `lineNo`는 1부터 |
| 상한 가드 | insert 잡은 다음 번호가 `LINE_NO_MAX`(2,000,000,000)를 넘으면 **wrap하지 않고 그달 적재를 중단** |
| 퍼지 | `apiYn=Y`는 보관 기간 후 삭제/아카이브. Sample을 연 12억 행 창고로 쓰지 않음 |
| Factory | pending 중 가장 앞 `ingestYm`만 이번 라운드에 넣는다. 월이 섞인 구간은 만들지 않음 |

월 1억은 `long` 안이다. 영구 이력이 필요하면 Sample이 아니라 별도 아카이브 테이블을 쓴다.

### 3.3 insert 잡 계약 (샘플·PRD 공통)

1. 이번 행의 `ingestYm` = 적재 시각의 `YYYYMM`.
2. `lineNo` = 그 `ingestYm`의 `max(lineNo)+1`. 없으면 1.
3. `lineNo > LINE_NO_MAX` 이면 throw. 조용히 1로 되돌리지 않음.
4. 일 적재는 UID로 덮어쓰지 않는다. 그날 대상은 새 `lineNo`로 insert. 같은 UID가 어제/오늘 두 줄.
5. 같은 날 파일을 재처리하면 `(ingestYm, lineNo)` 로만 업서트. UID 단독 업서트는 어제 이력을 지운다.

---

## 4. 구성 요소

```
new_ver/
  js/testWooBulkApiWorker.js              라이브러리 wootar:testWooBulkApiWorker[.js]
  schema/testWooTargetSample.xml          샘플 큐. ingestYm + lineNo
  schema/testWooTargetBulkApiMaster.xml   배치 1건 로그
  schema/testWooTargetBulkApiDetail.xml   UID 1건 로그. Master 1:N
  test/01_SmokeConfig.js ~ 07_...         Phase A 스모크
  workflow/factory/00_Config.js           Factory 설정
  workflow/factory/01_WorkerDistributor.js 한 월 lineNo 분할
  workflow/factory/02_Polling.js          Option 폴링
  workflow/worker/worker.js               TBAWn 진입
  js/testWooBulkApiStatus.js              적재 GET 라이브러리
  workflow/status/00_Config.js            Status WF
  workflow/status/01_StatusGet.js
  workflow/status/02_Decide.js
```

| 역할 | Campaign | 코드 | 통신 |
|---|---|---|---|
| Factory | 메인 WF | 00 / 01 / 02 + Test | `PostEvent`, `setOption` / `getOption` |
| Worker | TBAW1..N | worker.js + 라이브러리 | Signal vars → Option 상태 |
| Smoke | TBAWSmoke + TBAWSmokeSignal | test/* | 동일 전송 라이브러리. Phase A에서 검증 완료 |
| Status | TBAWStatus | workflow/status + status 라이브러리 | Master URL GET. 전송과 다른 WF |

---

## 5. Factory 흐름

워크플로우 (화면 기준):

```
Start
  --> 00_Config                 Ok
  --> 01_Worker Distributor
  --> 02_Polling
  --> 03_Test
        |-- working --> 1m Wait --> 02_Polling
        |-- next    --> 01_Worker Distributor
        +-- finish  --> End
```

`03_Test`는 `instance.vars.nextAction`을 본다.

| nextAction | 의미 |
|---|---|
| `working` | 워커 미완료. 1분 후 재폴링 |
| `next` | 라운드 완료. 다음 분배 |
| `finish` | 대상 없음 / 상한 / 워커 0 |

**라운드:** 01이 워커를 한 번 쏘는 단위. 라운드 동안 Test는 `working`으로 02를 반복한다. Test의 `next`는 그 라운드가 끝났고 01로 돌아간다는 뜻이다.

### 5.1 00_Config

설정은 `FACTORY_CFG` + `loadLibrary` 후 `BULK_CFG`. getOption으로 설정을 읽지 않는다.

조절 지점: `ROUND_LIMIT`(한 라운드에 나눌 pending 행 수), `GRAND_TOTAL`(이 실행의 누적 성공 sent. 0=무제한).

둘을 같게 두면 한 라운드에 목표를 넣고 종료한다. `ROUND_LIMIT=500000`, `GRAND_TOTAL=5000000`이면 성공이 빠지지 않을 때 약 10라운드다.

워커 수·배치·스키마·토큰·CUSTOM_ATTR·`LINE_NO_MAX`는 `BULK_CFG`. Factory가 다시 선언하거나 시그널로 덮지 않는다. Option 키는 `WORKER_DONE_TBAWn`.

### 5.2 01_WorkerDistributor

1. pending을 `@ingestYm ASC, @lineNo ASC`로 두고 첫 행을 읽는다. 없으면 `finish`.
2. 이번 라운드 `ingestYm` = 그 첫 행의 월. 다른 월은 넣지 않음.
3. `ROUND_LIMIT`와 `GRAND_TOTAL` 잔여로 remaining. 그 월 pending보다 크면 그 월 잔여로 자름.
4. `runId = yyyyMMddHHmmss + R + round`.
5. offset 분할: 같은 월 정렬 목록에서 워커 수만큼 경계 `lineNo` 조회. 닫힌 구간. 번호-1 산술 없음(중간에 Y가 빠져 공백이 있어도 됨).
6. 워커별 Option: `{runId}|ready` 또는 `{runId}|skip`.
7. PostEvent vars: `runId`, `workerName`, `ingestYm`, `lineStart`, `lineEnd`, `optKey`, `workerCount`(실발사 수). `batchSize`/`dryRun`/`customAttr`/`authToken`은 워커가 `BULK_CFG`에서 읽는다.
8. 할당 0이거나 워커 WF가 시작됨(11)이 아니면 `skip`. 전원 미발사이면 `finish`.
9. PostEvent 사이 `STAGGER_POST` ms.

skip 워커도 Option을 남긴다. 이전 라운드 `done` 잔존으로 폴링이 끝나는 구멍을 막는다.

워커 WF `TBAWn`이 없으면 skip 로그. 늘릴 때 WF를 먼저 Start 한다.

### 5.3 02_Polling

Option 값: `{runId}|{status}` 또는 `{runId}|done|{sent}|{failed}`.

| status | 동작 |
|---|---|
| `done` / `skip` | 완료 |
| `error` | 목록에 추가. `ABORT_ON_WORKER_ERROR`면 throw, 아니면 제외하고 진행 |
| `ready` | 시그널 미수신. `MAX_READY_POLL` 초과면 error |
| 그 외 (`running`) | pending |
| Option의 runId ≠ 이번 runId (`STRICT`) | stale. pending |

라운드 타임아웃: `pollCount >= MAX_RUN_POLL`.

전원 완료면 `globalProcessed +=` 워커가 보고한 `sent` 합. GrandTotal 도달 시 `finish`, 아니면 `next`. 상한은 나눠 준 행 수가 아니라 실제 전송 건수다.

### 5.4 동시 워커

워커 WF는 프로세스마다 `this`가 따로 있다. `BULK_CFG`는 읽기 전용.

| 공유 자원 | 안전 장치 |
|---|---|
| Sample 행 | 같은 `ingestYm` + 닫힌 `lineNo` 구간. 조회 `>=lineStart <=lineEnd`, 커서는 `> lastLine` |
| apiYn UPDATE | 배치 firstLine~lastLine. 구간이 안 겹치면 행 경합 없음 |
| Master | `batchName = {workerName}-{runId}-{batchNo}` unique |
| Detail | `_key=@ingestYm,@lineNo`. 큐 행 1건 = Detail 1건. 같은 UID 여러 로그 |
| Option | 워커당 `WORKER_DONE_TBAWn` 1키 |
| Target 50콜/분 | `workerCount`로 스로틀. 첫 POST는 `STAGGER_SLOT_MS × (n-1)`. Factory PostEvent도 300ms 간격 |

워커를 늘릴 때: TBAWn 을 Start → `BULK_CFG.WORKER_COUNT`를 같은 수로. 15 초과는 `WORKER_MAX`로 클램프.

---

## 6. Worker 진입

운영 진입은 `workflow/worker/worker.js`. 스모크 `test/07_SmokeSignalWorker.js`와 같은 시그널 필드(`ingestYm`, `lineStart`, `lineEnd`)를 받는다. Factory는 `done|sent|failed`를 보고한다.

```
signal
  --> 진입 JS
        loadLibrary("wootar:testWooBulkApiWorker.js")
        report(runId + "|running")
        new BulkApiWorker(vars).run()
        report(runId + "|done" | runId + "|error")
  --> End
```

예외는 rethrow하지 않는다. 워커 WF가 Error로 멈추면 다음 PostEvent가 큐에만 쌓인다.

```
setOption(optKey, runId + "|" + status)
  // Factory(Phase B) done 이면 runId|done|sent|failed
new BulkApiWorker(vars)
  // Factory: workerName, ingestYm, lineStart, lineEnd, runId, workerCount, optKey
  // batchSize·dryRun·authToken·customAttr 은 BULK_CFG (스모크만 시그널 오버라이드)
```

설정은 Option이 아니다. 토큰·CUSTOM_ATTR·스키마는 `BULK_CFG` 또는 시그널. Option은 상태 핸드셰이크만.

라이브러리명은 Campaign에 등록된 내부명을 그대로 쓴다. `.js` 포함 여부는 콘솔에서 확인한다.

---

## 7. 라이브러리 계약 (기준 구현)

파일: `new_ver/js/testWooBulkApiWorker.js`  
전역 설정: `BULK_CFG`  
생성자: `new BulkApiWorker(p)` — p는 Signal `vars`.

### 7.1 입력

| 필드 | 필수 | 기본 | 의미 |
|---|---|---|---|
| `workerName` | 권장 | `W0` | 로그·batchName |
| `ingestYm` | 필수 | 빈 값이면 throw | `YYYYMM`. 이번 구간 월 |
| `lineStart` / `lineEnd` | 필수 | 없거나 역전이면 throw | 닫힌 `lineNo` 구간. 1 이상, `lineEnd <= LINE_NO_MAX` |
| `batchSize` | 선택 | `BULK_CFG.BATCH_SIZE`. 상한 500000 | Factory는 생략. 스모크 실전송만 넘김 |
| `runId` | 선택 | 워커 시각 | 전 워커 동일해야 회차 조회 가능 |
| `dryRun` | 선택 | false | `"true"`면 POST·apiYn 생략. 조회/CSV/로그는 수행 |
| `workerCount` | 선택 | 5. 1 미만이면 1 | 스로틀 계산 |
| `authToken` | 선택 | 빈 값 | Profile API 토큰(Bearer). 없으면 `BULK_CFG.AUTH_TOKEN`. 둘 다 비면 헤더 생략 |
| `customAttr` | 선택 | 빈 값 | 추가 컬럼. 없으면 `BULK_CFG.CUSTOM_ATTR` |

### 7.2 run() 순서

```
lastLine 비움
  |
  v
queryMembers  (apiYn N 또는 NULL AND ingestYm AND lineNo 커서)
  |
  +-- 0건 --> 종료 { sent, failed, batches }
  |
  +-- N건 --> generateSegId (더미 w01..w50, 255 절단)
                --> callBulkApi
                      |-- 성공 --> saveMaster(URL) --> saveToDb --> updateApiYn
                      +-- 실패 --> saveMaster(fail). Detail/apiYn 없음
                --> lastLine = 배치 끝 lineNo (성공/실패 공통)
                --> 연속 실패 MAX_ERROR(3)면 throw
```

커서를 실패 후에도 미는 이유: 같은 구간을 무한 재시도하지 않기 위함. 실패 행은 `apiYn='N'`이라 다음 라운드에서 다시 집힌다.

### 7.3 조회

- `@apiYn = 'N' OR @apiYn IS NULL`. 갱신 SQL과 동일.
- `@ingestYm = '{이번 월}'`.
- `distinct` 없음. 같은 UID가 구간에 여러 줄이면 그대로 여러 번 전송.
- 첫 조회: `@lineNo >= lineStart`. 이후: `@lineNo > lastLine`. 항상 `@lineNo <= lineEnd`.
- `orderBy @lineNo ASC`.
- `ingestYm`은 `sqlLit`. `lineNo`는 정수만.
- `CUSTOM_ATTR`이 있으면 해당 `@속성명`을 select에 붙인다. 스키마에 없는 이름은 queryDef 예외.

### 7.4 전송

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
- `<batchStatus>` URL은 Master에만 저장. 적재 GET은 `workflow/status` (`docs/statusLogic.md`).
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

### 7.5 저장

Master: `insertOrUpdate` `_key=@batchName`.  
`batchName = {workerName}-{runId}-{batchNo}`.  
항상 기록: workerName, runId, recordCount, httpCode, success(1/0), attemptCount, elapsedMs, batchStatusUrl(255 절단), errorMessage(255 절단), lastModified.  
짧은 조회를 했을 때만: batchStatus, consumedCount, successfulUpdates, failedUpdates, profilesNotFound, statusCheckedDate.  
autopk는 batchName으로 `get` 재조회 (`sqlLit`).

Detail: 성공 배치만. `WriteCollection`, `_key=@ingestYm,@lineNo`, `master-id`. masterId 0이면 생략(고아 방지). 같은 UID는 큐 행마다 로그가 남는다.

apiYn: 같은 `ingestYm` + 배치 `lineNo` 구간 UPDATE. DRY_RUN이면 생략. SQL은 `N OR NULL`도 갱신.

### 7.6 더미 세그먼트

`generateSegId`는 테스트용. 운영에서는 **이 함수 본문만** 교체한다. 반환은 파이프 연결 문자열 1개. `clipSegId`가 255에서 자른다. CSV와 Detail 모두 절단값을 쓴다.

### 7.7 CUSTOM_ATTR — 가변 프로필 컬럼

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
- 예약 제외: `membershipUid`, `apiYn`, `segId`/`seg_id`, `thirdPartyId`, `ingestYm`, `lineNo`.
- 대소문자만 다른 중복은 첫 이름만. Target 헤더는 스키마 속성명 그대로(대소문자 구분 → `profile.planName`).
- 값은 `EXTRA_VAL_MAX`(256)에서 절단. in-mbox profile 한도에 맞춤.

용도: Target이 thirdPartyId 기준으로 `profile.*`를 갱신한다. 캠페인에 필요한 속성을 일배치로 올리고, 오디언스에서 그 속성으로 타겟을 고를 수 있다. Detail에는 남기지 않는다(전송 전용).

샘플에서 쓰기 좋은 이름: `mConsent`, `planCode`, `planName`, `phoneNumber`, `optimalSendTime`. `created` / `lastModified` / `ingestYm` / `lineNo`는 넣지 않는다.

---

## 8. old_ver 대비 라이브러리에서 좋아진 점

| 항목 | old_ver | new_ver |
|---|---|---|
| 설정 충돌 | 생성자 필드 분산 | `BULK_CFG` 접두어 |
| 파라미터 | 위치 인자 3개 | Signal 객체. dryRun / runId / workerCount / 큐 키 |
| Worker 조회 | apiYn 필터 없음 | `@apiYn = 'N'` + 큐 키 |
| distinct | 사용 (대량에서 비쌈) | 제거. UID 중복 행을 그대로 전송 |
| CSV 조립 | `+=` | 배열 join |
| 파일 한도 | 없음 | 50MB throw |
| 분당 50콜 | 없음. 503을 일반 5xx(5초)로 처리 | 스로틀 + 503은 65초 |
| sleep 단위 | `sleep(10)` = 10ms. 주석은 10초 | ms 상수. 공식 `sleep(delay)`는 milliseconds |
| 429 vs 503 | 429만 구분 | 429 / 503 / 기타 5xx 분리 |
| MemoryBuffer | 재시도마다 재사용은 했으나 주석 없음 | 루프 밖 1회. body 재사용 문서화 |
| 실패 커서 | 전진. 같은 run에서 재시도 없음 | 동일. 다음 라운드 재처리로 명시 |
| skip 워커 | Option 미기록 → 폴링 무한 | Factory가 `skip` 기록 (Phase B) |
| Test 분기 | 하드코드 한도 | `nextAction` + GrandTotal (Phase B) |
| 라운드 식별 | 없음 | `runId` (Option·batchName) |
| 관측 | httpCode, success | + attemptCount, elapsedMs |
| Dry run | 없음 | 전송/플래그만 생략 |
| Detail 고아 | masterId 실패해도 저장 시도 | masterId 0이면 생략 |
| 연속 실패 Master | 실패 시 기록 예외면 워커 중단 | 실패 Master는 내부 try. 루프 유지 |
| 워커 WF 에러 | throw 시 WF 정지 | 진입점이 삼킴 |

---

## 9. 라이브러리 검수

Adobe Campaign 워크플로우 JS는 SpiderMonkey + E4X다. `let` / `const` / 화살표 / `Array.map` / `forEach` / 템플릿 리터럴은 쓰지 않는다. `for each`, E4X XML, `var`, `parseInt(x, 10)`는 ACC에서 실행 가능한 형태다.

`sleep`은 공식 문서상 **milliseconds**.

### 9.1 지금 상태로 동작하는 것

- 같은 `ingestYm` + `lineNo` 구간 + 커서 + BATCH_SIZE 분할 전송
- 공식 v2 CSV (`batch=thirdPartyId,seg_id[,CUSTOM_ATTR...]`, form-urlencoded, binary body)
- HTTP / `<success>true>` 2단 판정
- 429 / 503 / 5xx 재시도, 4xx 즉시 실패
- 계정 분당 50콜 방어
- Master/Detail + apiYn(큐 키 UPDATE)
- DRY_RUN
- 연속 3 배치 실패 시 워커 중단
- Bearer 선택 적용 (시그널 / `BULK_CFG.AUTH_TOKEN`)
- `ingestYm` `sqlLit`, apiYn N/NULL 조회, segId 255 절단, UID URL-encode
- POST 후 Master에 batchStatusUrl만 저장. 적재 GET은 Status WF
- Master.`runId`
- CUSTOM_ATTR 가변 컬럼. 기본은 uid+seg_id

### 9.2 남은 공백

1. **적재 완료를 워커가 보장하지 않음.** `TBAWStatus`가 1~2시간 후 GET 한다. `docs/statusLogic.md`.
2. **`loadLibrary` 이름.** 코드는 `wootar:testWooBulkApiWorker.js`. 콘솔 내부명에 `.js`가 없으면 로드 실패다.
3. **Factory(Phase B)는 스모크 통과 후** 이 시그널 계약으로 작성한다.
4. **동기 HttpClientRequest 타임아웃.** 공식 `execute`의 timeout은 비동기 전용. 동기 기본 대기는 약 5분. async로 바꾸지 않음.
5. **토큰 회전.** 재발급 시 `BULK_CFG.AUTH_TOKEN`만 바꾼다. 값은 로그에 안 남긴다.

쓰지 말 것: `Promise`, `JSON.stringify` 의존, `const`/`let`, `forEach`, 템플릿 리터럴, optional chaining.

---

## 10. 스키마

네임스페이스 `wootar`. 물리 테이블은 `{Namespace}{SchemaName}` 캐멀 연결. 코드: `WootarTestWooTargetSample`. 큐 컬럼 물리명: `singestym`, `ilineno`. Smoke는 `wootartestwootargetbulkapimaster`로 Master 컬럼 존재를 확인한다.

### 10.1 `testWooTargetSample`

테스트 전송 큐다. PRD 고객 스키마로 쓰지 않는다.

| 필드 | 타입 | 용도 |
|---|---|---|
| `membershipUid` | string 10, notNull | Target thirdPartyId. 유니크 아님 |
| `ingestYm` | string 6 | 적재월 YYYYMM. **기존 적재 테이블은 notNull 금지** (PGS-220000) |
| `lineNo` | long | 월내 일련. Default 0 NOT NULL 이면 유니크 충돌 |
| `apiYn` | enum N/Y, notNull, default N | 미전송/제출 |
| `mConsent` 등 | 샘플 표현 | `CUSTOM_ATTR`에 넣으면 전송 |
| `created` / `lastModified` | datetime | 샘플 표현. 큐 키 아님 |

키: `queueLine` = (`ingestYm`, `lineNo`) unique 만.

인덱스: `idx_mt_apiYn_queue` (`apiYn`, `ingestYm`, `lineNo`) — pending 스캔. `idx_membershipUid` 비유니크. `idx_sg_planCode`는 샘플 조회용.

라이브러리 전제: 같은 UID 여러 행 허용. 조회는 N 또는 NULL. 구간은 큐 키.

### 10.2 `testWooTargetBulkApiMaster`

워커가 쓰는 필드만으로도 제출 로그는 성립한다.

| 필드 | 타입 | 워커 |
|---|---|---|
| `batchName` | string 100 UK | 기록. insertOrUpdate 키 |
| `workerName` | string 20 | 기록 |
| `runId` | string 40 | 기록. `idx_runId` |
| `recordCount` | long | 기록 |
| `attemptCount` | byte | 기록 |
| `elapsedMs` | long | 기록 |
| `httpCode` | short | 기록 |
| `success` | byte + enum | 기록 1/0 |
| `errorMessage` | memo | 기록 (코드는 255자 절단) |
| `batchStatusUrl` | string 255 | 기록 (절단) |
| `createdDate` | datetime default | 코드 미기록. DB default |
| `lastModified` | datetime | 기록 |
| `batchStatus` | string enum | Status WF GET 성공 시 |
| `consumedCount` 등 | long | showDetails |
| `statusCheckedDate` | datetime | 마지막 조회 시각 |

인덱스: `idx_batchName` 필수. `idx_runId` 회차 조회. `idx_success_status`는 incomplete 재조회용.

**넣지 않음:** clientCode, apiVersion, payloadBytes, 큐 구간 복제, responseBody, payloadJson.

`batchStatus` 일족은 `TBAWStatus`가 채운다. 전송 워커는 URL만 남긴다.

### 10.3 `testWooTargetBulkApiDetail`

| 필드 | 워커 |
|---|---|
| `membershipUid` | 기록. 유니크 아님 |
| `ingestYm` / `lineNo` | 기록. 큐 행 식별. unique |
| `segId` 255 | 기록 (절단) |
| `createdDate` default | 미기록 |
| `lastModified` | 기록 |
| `master` link neutral | `master-id` |

CUSTOM_ATTR 값은 Detail에 복제하지 않는다. 규칙: 성공 배치만 Detail, **큐 행당 1행**. 같은 UID는 날짜·세그마다 로그가 쌓인다. 퍼지는 Sample과 별도로 보관 기간 후 삭제.

### 10.4 관계

```
testWooTargetSample (queueLine UK, membershipUid 비유니크, apiYn)
        |
        |  큐 키(ingestYm+lineNo)로 대응. UID FK 아님
        v
testWooTargetBulkApiDetail (queueLine UK, membershipUid 비유니크, segId)
        ^
        |  master-id  (1 Master : N Detail)
        |
testWooTargetBulkApiMaster (batchName UK)
```

---

## 11. Smoke 흐름 (Phase A)

설정은 `01` 상단 스위치 + `BULK_CFG`. 활동 이름·선은 기존과 같다.

```
Start
  --> 01_Config         BULK_CFG 검사. SMOKE_REAL_ROWS=2
  --> 02_Local          스키마 I/O, 큐 키 offset 분할, 같은 캔버스 dryRun
  --> 03_Fire           pending 2건 PostEvent (ingestYm/lineStart/lineEnd). dryRun=false
  --> 30s Wait
  --> 04_Poll           {runId}|status  (제출 완료. 적재 완료 아님)
  --> Test
        |-- Working --> 30s Wait --> 04_Poll
        |-- False   --> End Error
        +-- Done
              --> 05_ApiTest     Master batchStatus + Profile Fetch 1건
              --> 1m Wait        적재 여유
              --> 06_Verify      apiYn=Y(큐 키), Fetch 재시도, 로그 삭제
              --> End
```

별도 WF `TBAWSmokeSignal`: 항상 시작됨. `07`이 라이브러리를 실행한다. **여기서 샘플 UID를 샌드박스 Target에 실전송한다.**

| 활동 | 하는 일 | 안 하는 일 |
|---|---|---|
| 02 | 로컬 계약, 큐 키 분할, dryRun Master(`DRYRUN`) | Target POST |
| 03+07 | 라이브러리 실전송 2건 | 300건, 가짜 SMOKE_TEST_A/B |
| 04 | 워커 프로세스 종료 | ingest complete 보장 |
| 05 | 실전송 Master URL GET, Fetch 1 UID, Postman URL 로그 | 새 가짜 프로필 생성 |
| 06 | 큐 키 구간 apiYn=Y, Fetch 재시도 | Fetch 404를 FAIL로 두지 않음 |

Fetch 404는 공식 적재 지연(최대 24시간)일 수 있다. 제출 성공은 Master `httpCode=200` + `batchStatusUrl`이 `http`로 시작. Target 값은 Postman GET `.../profiles/thirdPartyId/{uid}?client={CLIENT_CODE}` 로 확인.

통과 기준: FAIL=0. 2026-08-21 LineNo Ver 2가 PASS=50로 통과했다.

---

## 12. 재배포 목록과 가이드 (Phase B)

스키마·라이브러리·스모크는 Phase A에서 이미 게시됐다. 지금은 Factory와 워커 JS만 올린다.

예전 `uidStart`/`uidEnd` Factory를 그대로 두면 워커가 생성자에서 throw한다. 00/01/워커를 **같이** 올린다.

### 12.1 배포 대상

| 순서 | Campaign 자원 | 원본 | 비고 |
|---|---|---|---|
| 1 | Factory 활동 `00_Config` | `workflow/factory/00_Config.js` | `PENDING_COND`에 `lineNo>=1` + `ingestYm` |
| 2 | Factory 활동 `01_WorkerDistributor` | `workflow/factory/01_WorkerDistributor.js` | PostEvent: `ingestYm`/`lineStart`/`lineEnd` |
| 3 | Factory 활동 `02_Polling` | `workflow/factory/02_Polling.js` | Option `{runId}|done|{sent}|{failed}` 그대로 |
| 4 | 워커 WF `TBAW1`..`TBAWn` JS | `workflow/worker/worker.js` | 전 워커 동일 코드. `sigWorker` |

캔버스 선은 유지한다. JS만 교체한다. 라이브러리는 스모크와 같은 게시본을 쓴다.

### 12.2 실행 전 체크

1. `TBAW1`..`TBAW5`(또는 `WORKER_COUNT`) state=11. 미시작은 01이 skip.
2. `urlPermission`에 `tt.omtrdc.net`.
3. pending은 `apiYn N` + `lineNo>=1` + `ingestYm` 있음.
4. 예전 `uidStart` 시그널을 쓰는 워커 JS가 남아 있으면 교체 후 기동.

### 12.3 운영 조절

| 값 | 위치 | 의미 |
|---|---|---|
| `WORKER_COUNT` | `BULK_CFG` | 발사 TBAWn 수 + 스로틀 기본. 상한 `WORKER_MAX` |
| `BATCH_SIZE` | `BULK_CFG` | 워커 조회/POST 행수. Factory가 시그널로 안 넘김 |
| `ROUND_LIMIT` | `FACTORY_CFG` | 한 라운드, 한 월의 앞 N건 |
| `GRAND_TOTAL` | `FACTORY_CFG` | 이 실행 누적 sent. 0=무제한 |
| 스키마·토큰·CUSTOM_ATTR | `BULK_CFG` | Factory가 시그널로 복사하지 않음 |
