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
| `workflow/factory/*` | 분배·폴링·설정 | 프로토타입. 그대로 운영 투입 불가 |
| `workflow/worker/worker.js` | Signal → 라이브러리 실행 | 프로토타입. Option 포맷이 Factory와 어긋남 |
| `test/*` | Smoke 워크플로우 | 프로토타입. 라이브러리 검증용 캔버스 |

다음 Phase: 라이브러리를 기준으로 Factory/Worker를 수정·재생성·삭제한다. 라이브러리 잔여 이슈는 `8.2`를 본다.

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
  workflow/factory/00_Config.js           [PT] 옵션 → instance.vars. 미완성
  workflow/factory/01_WorkerDistributor.js [PT] 분배 + PostEvent
  workflow/factory/02_Polling.js          [PT] Option 폴링 + nextAction
  workflow/worker/worker.js               [PT] Signal 수신 진입점
  test/01_SmokeConfig.js ~ 07_...         [PT] 스모크
```

| 역할 | Campaign | 코드 | 통신 |
|---|---|---|---|
| Factory | 메인 WF | 00 / 01 / 02 + Test | `PostEvent`, `setOption` / `getOption` |
| Worker | TBAW1..N | worker.js + 라이브러리 | Signal vars → Option 상태 |
| Smoke | TBAWSmoke + TBAWSmokeSignal | test/* | 동일 라이브러리, dryRun / 실호출 스위치 |

---

## 4. Factory 흐름 (프로토타입)

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

### 4.1 00_Config — 미완성

있는 것: Option 헬퍼(`cfg` / `cfgNum` / `cfgPos` / `cfgBool`), MemberSchema / WorkerCount / BatchSize / RoundLimit / GrandTotal / Enabled.

없는 것 (Distributor·Polling이 읽음):

`OPT_PREFIX`, `CFG_*` 기본값, `PENDING_COND`, `PARTITION_MODE`, `UID_PREFIX`, `UID_DIGITS`, `EXACT_COUNT`, `WORKER_NAME_TPL`, `WORKER_WF_TPL`, `WORKER_SIG_TPL`, `STRICT_RUNID`, `ABORT_ON_WORKER_ERROR`, `MAX_READY_POLL`, `MAX_RUN_POLL`, `Enabled`로 `finish` 처리.

이 파일만으로는 Factory가 기동하지 않는다. 다음 Phase에서 라이브러리 `BULK_CFG`와 옵션 키를 맞춰 다시 쓴다.

### 4.2 01_WorkerDistributor — 의도

1. 미전송 min/max UID 조회 (`PENDING_COND`).
2. 없으면 `finish`.
3. `ROUND_LIMIT`와 `GRAND_TOTAL`로 이번 라운드 상한.
4. `EXACT=true`면 count. 아니면 범위만 보고 remaining = limit.
5. `runId = yyyyMMddHHmmss + R + round`.
6. 분할:
   - `arith`(권장): UID가 `{prefix}{숫자패딩}`일 때 산술. 조회 2회.
   - `offset`: startLine으로 경계 UID. 워커 수만큼 조회. 공백 UID에 안전.
7. 워커별 Option: `{runId}|ready` 또는 `{runId}|skip`.
8. PostEvent vars: `runId`, `workerName`, `uidStart`, `uidEnd`, `batchSize`, `optKey`.
9. 할당 0이면 `finish`.

old_ver 대비: skip 워커도 Option을 남긴다. 이전 라운드 `done` 잔존으로 폴링이 끝나는 구멍을 막으려 한 설계다. `runId`를 Option에 넣어 라운드 혼선을 줄인다.

프로토타입 한계:

- `EXACT=false`면 `roundSize = remaining(상한)`이다. 실제 전송 건수와 다를 수 있다. Polling이 이 값으로 `globalProcessed`를 올려 GrandTotal이 어긋날 수 있다.
- arith는 샘플 UID 형태(`U` + 9자리 등) 전제. 실제 멤버십 UID가 비연속이면 빈 구간·누락이 난다. 그때는 offset.
- `dryRun`, `workerCount`, `authToken`, `customAttr`은 PostEvent에 없다. 라이브러리는 받는다.

### 4.3 02_Polling — 의도

Option 값: `{runId}|{status}` 또는 상태만.

| status | 동작 |
|---|---|
| `done` / `skip` | 완료 |
| `error` | 목록에 추가. `ABORT_ON_WORKER_ERROR`면 throw, 아니면 제외하고 진행 |
| `ready` | 시그널 미수신. `MAX_READY_POLL` 초과면 error |
| 그 외 (`running`) | pending |
| Option의 runId ≠ 이번 runId (`STRICT`) | stale. pending |

라운드 타임아웃: `pollCount >= MAX_RUN_POLL`.

전원 완료면 `globalProcessed += roundSize`. GrandTotal 도달 시 `finish`, 아니면 `next`.

프로토타입 한계: Worker 진입점이 `done`만 쓰고 runId를 안 붙이면, STRICT에서 영원히 stale이 된다. `8.2` 참조.

---

## 5. Worker 진입 (프로토타입)

```
signalTBAWn
  --> worker.js
        loadLibrary("wootar:testWooBulkApiWorker.js")
        report("running")
        new BulkApiWorker(vars).run()
        report("done" | "error")
  --> End
```

의도된 개선: 예외를 rethrow하지 않는다. 워커 WF가 Error로 멈추면 다음 PostEvent가 큐에만 쌓인다. 실패는 Option `error`로만 알린다.

깨진 계약: `report(status)`가 `running` / `done` / `error`만 쓴다. Distributor는 `{runId}|ready`를 심는다. Polling STRICT는 `{runId}|status`를 기대한다.

다음 Phase Worker 진입점은 최소한 아래를 지켜야 한다.

```
setOption(optKey, runId + "|" + status)
new BulkApiWorker(vars)   // workerName, uidStart, uidEnd, batchSize, runId, dryRun, workerCount, authToken, customAttr
```

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
| `authToken` | 선택 | 빈 값 | Bearer. 없으면 `BULK_CFG.AUTH_TOKEN` → `AUTH_OPTION` |
| `customAttr` | 선택 | 빈 값 | 추가 컬럼. 없으면 `BULK_CFG.CUSTOM_ATTR` → `CUSTOM_ATTR_OPTION` |

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

우선순위: 시그널 `customAttr` → `BULK_CFG.CUSTOM_ATTR` → `CUSTOM_ATTR_OPTION`.

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
- Bearer 선택 적용 (시그널 / CFG / Option)
- UID `sqlLit`, apiYn N/NULL 조회, segId 255 절단, UID URL-encode
- POST 직후 batchStatus 짧은 GET → Master 적재 컬럼
- Master.`runId`
- CUSTOM_ATTR 가변 컬럼 (조회 select + CSV 헤더/행). 기본은 uid+seg_id

### 8.2 기능 — 남은 공백

1. **적재 완료를 워커가 보장하지 않음.** `POLL_MAX=2`는 스냅샷이다. incomplete는 후속 잡이 재조회해야 한다.
2. **`loadLibrary` 이름.** 코드는 `wootar:testWooBulkApiWorker.js`. 콘솔 내부명에 `.js`가 없으면 로드 실패다. Factory/Worker Phase에서 맞춘다.
3. **Worker Option 계약 (진입점).** `worker.js`(PT)가 `done`만 쓰면 STRICT 폴링과 어긋난다.
4. **동기 HttpClientRequest 타임아웃.** 공식 `execute`의 timeout은 비동기 전용. 동기 기본 대기는 약 5분. async로 바꾸지 않음.
5. **토큰을 코드/Option에 둘 때 회전.** 재발급 시 `AUTH_TOKEN` / Option을 같이 바꿔야 한다. 값은 로그에 안 남긴다.

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

## 10. Smoke 흐름 (프로토타입)

화면 기준:

```
Start
  --> 01_Config
  --> 02_Local          (2s)
  --> 03_Fire           (2s)  PostEvent → TBAWSmokeSignal
  --> 30s Wait
  --> 04_Poll
  --> Test
        |-- Working --> 30s Wait --> 04_Poll
        |-- False   --> End Error
        +-- Done
              --> 05_ApiTest
              --> 1m Wait
              --> 06_Verify
              --> End
```

별도 WF `TBAWSmokeSignal`: 항상 시작됨. `07_SmokeSignalWorker.js`가 같은 라이브러리를 dryRun으로 돌린다.

주의: `07`이 `w.SEG_MIN`을 읽는다. 그 값은 `BULK_CFG`에 있고 인스턴스에 없다. 비교는 항상 통과한다. 죽은 검사다.

`05`는 가짜 thirdPartyId 2건을 실엔드포인트에 넣는다. `06`은 batchStatus GET + SMOKE 로그 삭제.

---

## 11. Phase 1~3 보고 / 다음 Phase

완료한 것:

1. 이 문서에 Factory / Worker / 라이브러리 / 스키마 / Smoke 큰 흐름을 모았다.
2. 라이브러리 검수 보완을 반영했다. 인증, UID escape, apiYn NULL, segId 절단, 짧은 batchStatus GET, runId 저장, CUSTOM_ATTR 가변 컬럼.
3. Master에 `runId` + `idx_runId`를 추가했다. Sample은 불변.

다음 Phase에서 할 일:

- `00_Config`를 라이브러리·Option 계약으로 재작성하거나 대체
- Worker 진입점 Option을 `{runId}|status`로 맞춤
- Distributor PostEvent에 `workerCount` / `dryRun` / `authToken` / `customAttr` / 실제 sent 보고
- incomplete Master 재조회 잡 (선택)
- Smoke를 기준 라이브러리와 재정렬하거나 삭제
- Campaign 콘솔에서 라이브러리 내부명(`.js` 여부) 확인 후 `loadLibrary` 맞추기
