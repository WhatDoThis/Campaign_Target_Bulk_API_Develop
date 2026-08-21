# Status 재조회 Logic

전송 Factory와 다른 워크플로우다. **제출이 끝난 뒤 최소 1~2시간 후**에 돌린다. 적재는 보통 1시간 안, 공식 상한은 24시간이다.

기준 구현: `new_ver/js/testWooBulkApiStatus.js`  
공식 status: Experience League Bulk Profile Update API — `complete` / `incomplete` / `stuck`.

---

## 1. 왜 분리하는가

전송 워커의 POST 직후 GET은 거의 항상 `incomplete`다. GET은 계정 50콜/분을 POST와 나눠 써서 전송만 느려진다.

워커는 `batchStatusUrl`만 Master에 남긴다. 이 잡이 URL을 GET 해서 적재 컬럼을 채운다. `success`, `apiYn`, Detail은 바꾸지 않는다.

---

## 2. 흐름

```
Start
  --> 00_Config
  --> 01_StatusGet          청크 N건 GET + Master 갱신
  --> 02_Decide             pending 잔여 판정
  --> 03_Test
        |-- working --> 1m Wait --> 01_StatusGet
        +-- finish  --> End
```

`03_Test`는 `instance.vars.nextAction`만 본다. `working` | `finish`.

한 JS가 전 건을 돌지 않는다. `CHUNK_SIZE`(20)만큼만 GET하고 1분 쉰다.

### 2.1 Campaign Test / Wait (캔버스 입력값)

WF 내부명 예: `TBAWStatus`. Test 활동명 예: `03_Test`.  
조건식은 **JavaScript** 탭에 그대로 붙인다. (`02_Decide`가 `instance.vars.nextAction`에 문자열을 쓴다.)

**캔버스 연결**

```
02_Decide → 03_Test
  03_Test [working] → Wait (1 minute) → 01_StatusGet
  03_Test [finish]  → End
```

**Wait 활동**

| 항목 | 값 |
|---|---|
| 라벨 | `Wait 1m` (또는 `1분 대기`) |
| Duration | `1 minute` |

**Test 활동 — 전환(Transition) 2개만.** `next` 분기는 없다.

| # | 전환 라벨 (Label) | 조건 (Condition) | 다음 활동 |
|---|---|---|---|
| 1 | `working` | `String(instance.vars.nextAction) == 'working'` | Wait 1m → `01_StatusGet` |
| 2 | `finish` | `String(instance.vars.nextAction) == 'finish'` | End |

ACC UI에서 라벨을 한글로 쓰려면:

| # | 전환 라벨 | 조건 (동일) | 다음 |
|---|---|---|---|
| 1 | `처리중` | `String(instance.vars.nextAction) == 'working'` | Wait → 01 |
| 2 | `종료` | `String(instance.vars.nextAction) == 'finish'` | End |

**주의**

- 조건에 `next`를 넣지 않는다. Status JS는 `working` / `finish`만 설정한다.
- 매칭되는 전환이 없으면 WF가 멈춘다. `02_Decide`를 거친 뒤 Test로 가야 한다.
- `finish`여도 Master에 `incomplete`가 남을 수 있다 (`MAX_RUN_POLL` 타임아웃). 다음 WF 실행이 이어서 조회한다.

**Factory(`TBAWFactory`) Test 참고 — 3전환**

| 라벨 | 조건 |
|---|---|
| `working` | `String(instance.vars.nextAction) == 'working'` |
| `next` | `String(instance.vars.nextAction) == 'next'` |
| `finish` | `String(instance.vars.nextAction) == 'finish'` |

---

## 3. 대상

| 조건 | 포함 |
|---|---|
| `success = 1` | 제출 성공만 |
| `batchStatusUrl` 가 `http`로 시작 | DRYRUN·실패 Master 제외 |
| `batchStatus` 비었거나 `incomplete` | complete/stuck 는 종료 |

정렬: `@createdDate` 오름차순 (오래된 배치 먼저).

---

## 4. 건별 판정

GET `batchStatusUrl` + `showDetails=true`. URL은 POST 응답 그대로. 조립하지 않음.

| Target `<status>` | Master | 이후 |
|---|---|---|
| `complete` | `complete` | pending 제외 |
| `stuck` | `stuck` | pending 제외. 공식 중단 |
| `incomplete` | `incomplete` | 다음 사이클 |
| `unknown` 등 비공식 | `incomplete`로 정규화 | 로그 WARN, 재조회 |
| GET 실패 (4xx/5xx/예외) | 값 유지 | 다음 사이클. 제출 성공은 유지 |

추가 규칙: `incomplete` 인데 `createdDate`로부터 **24시간**이 지났으면 Master를 `stuck`으로 바꾼다. 공식 적재 상한이 24시간이고, GitHub 기준으로 batchId 조회도 약 24시간이다.

연속 GET 실패 `MAX_CONSEC_FAIL`(5)이면 그 청크의 나머지를 건너뛰고 다음 1분 사이클에서 재개한다.

---

## 5. 종료

| nextAction | 조건 |
|---|---|
| `finish` | pending 0 (전부 complete 또는 stuck) |
| `finish` | `pollCount >= MAX_RUN_POLL`(180, 약 3시간). 잔여 incomplete는 다음 WF 실행 |
| `working` | 그 외 |

같은 배치를 N번 GET했다고 바로 stuck 하지 않는다. 1~2시간 뒤에 시작해도 적재가 더 걸릴 수 있다. N회 상한 대신 **24시간 경과 → stuck**, **이번 실행 3시간 → 잔여는 다음 실행**이다.

---

## 6. 스로틀

상태 WF는 전송과 겹치지 않게 돌린다. 워커 1개 기준.

`MIN_INTERVAL = 60초 / (50 × 0.7)` ≈ 1.7초. 청크 20건 ≈ 35초 + HTTP.

429/503은 전송 라이브러리와 같은 대기(`WAIT_429_MS`, `WAIT_503_MS`).

---

## 7. 설정 (`STATUS_CFG`)

| 키 | 기본 | 의미 |
|---|---|---|
| `CHUNK_SIZE` | 20 | 활동 1회 GET 수 |
| `STUCK_AFTER_HOURS` | 24 | incomplete 로컬 stuck |
| `MAX_RUN_POLL` | 180 | Wait 1m 횟수 상한 |
| `MAX_CONSEC_FAIL` | 5 | 청크 조기 중단 |
| `GET_RETRY` | 3 | 한 URL 재시도 |

토큰·Master 스키마는 `BULK_CFG`. 여기서 다시 선언하지 않는다.

---

## 8. 파일

| 경로 | 역할 |
|---|---|
| `js/testWooBulkApiStatus.js` | `STATUS_CFG`, `BulkStatusChecker` |
| `workflow/status/00_Config.js` | 로드·vars |
| `workflow/status/01_StatusGet.js` | `runChunk` |
| `workflow/status/02_Decide.js` | pending → nextAction |

Campaign 내부명 예: 라이브러리 `wootar:testWooBulkApiStatus.js`, WF `TBAWStatus`. 캔버스 선은 위 2절. JS만 붙이면 된다.

전송 라이브러리 `wootar:testWooBulkApiWorker.js`는 POST 후 GET을 하지 않는다. `POLL_MAX`는 삭제됐다.

---

## 9. 배포

1. JS `wootar:testWooBulkApiStatus` 게시 (전송 라이브러리도 GET 제거본 재게시).
2. WF `TBAWStatus` 신설. 00/01/02 + Test + Wait 1m.
3. 전송 Factory가 **끝난 뒤 1~2시간** 스케줄 또는 수동 시작.
4. `urlPermission`에 `mboxedge*.tt.omtrdc.net` (batchStatus 호스트).

스키마 enum은 `incomplete` / `complete` / `stuck` 그대로. 컬럼 추가 없음.

---

## 10. 로그

- `[Status][PASS] {batchName} status=complete|stuck|incomplete ...`
- `[Status][FAIL] GET {batchName} :: http=...` — 제출은 유지
- `[StatusDecide] pending=N` — 잔여 확인 대상
