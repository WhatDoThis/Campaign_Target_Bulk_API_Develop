# Detail 폐기 · Sample FK 마이그레이션

Detail(`wootar:testWooTargetBulkApiDetail`) INSERT를 중단하고, Sample에 `segId` + `master` FK로 전송 이력을 추적한다.

---

## 0. STEP 3 segId 시딩 (실행 전 확인)

`sql/02_seed_segid.sql`의 `md5(g || lineNo)` 방식은 **같은 lineNo면 항상 동일 세그 조합**이다(결정론).

| 용도 | 권장 |
|---|---|
| 테스트/개발 Sample 백필 | `02_seed_segid.sql` 사용 가능 |
| 운영 세그 규칙이 별도로 정해진 경우 | **운영 적재 잡/SQL로 교체**. 본 파일은 사용하지 않음 |

워커는 `segId`가 비어 있으면 즉시 throw 한다. 시딩 없이 전송 WF를 돌리지 말 것.

---

## 실행 전 필수 확인

### 1) segId 시딩 완료 (결과 0 이어야 함)
```sql
SELECT COUNT(*) FROM wootartestwootargetsample
WHERE ssegid IS NULL OR btrim(ssegid) = '';
```

### 1-b) lineNo 백필 완료 (결과 0 이어야 함)
```sql
SELECT COUNT(*) FROM wootartestwootargetsample WHERE ilineno IS NULL;
```
`ilineno IS NULL` 이면 `(NULL % 100)` 시딩에서 조용히 누락됨. `backfillSampleQueue.sql` 선행 필수.

### 2) ingestYm 분포
```sql
SELECT singestym, COUNT(*) FROM wootartestwootargetsample
WHERE sapiyn = 'N' GROUP BY singestym ORDER BY singestym;
```
Distributor 는 head.ym 한 달만 처리한다.
ingestYm 이 N개면 라운드가 N회로 늘고, 회당 POLL_WAIT_SEC(15초)가 추가된다.
단일 라운드로 끝내려면 ingestYm 이 1개여야 한다.

### 3) apiYn 정합성 (결과 0 이어야 함)
```sql
SELECT COUNT(*) FROM wootartestwootargetsample
WHERE sapiyn IS NULL OR sapiyn NOT IN ('Y','N');
```

### 4) 인덱스 적용 확인
```sql
EXPLAIN SELECT ilineno FROM wootartestwootargetsample
WHERE sapiyn='N' AND singestym='YYYYMM' ORDER BY ilineno LIMIT 10;
```
`idx_pending_queue` 사용이 보여야 한다. Seq Scan 이면 구조 업데이트 재실행.

### 5) 부분 인덱스 **필수** — FIX-23

> **3단계 필수.** FIX-21 `splitBounds` 가 `MIN/MAX/COUNT(*)` 를 매 라운드 실행한다.
> 부분 인덱스 없이 5천만 pending 전량 COUNT 는 수십 초 소요.

```sql
-- psql 단독 실행 (ACC SQL 활동 금지 — CONCURRENTLY 는 트랜잭션 블록 불가)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sample_pending_partial
  ON wootartestwootargetsample (singestym, ilineno)
  WHERE sapiyn = 'N';

ANALYZE wootartestwootargetsample;
```

- 5천만 행 기준 생성: 수 분~수십 분 (부하·디스크에 따라 상이)
- 생성 직후 `ANALYZE` 필수 — planner 가 partial index 를 선택하도록
- XML `idx_pending_queue` 와 공존 가능 (ACC 마법사는 미인지 인덱스 삭제 안 함)
- 확인:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT MIN(ilineno), MAX(ilineno), COUNT(*)
FROM wootartestwootargetsample
WHERE sapiyn='N' AND singestym='YYYYMM';
-- → Index Only Scan (idx_sample_pending_partial) 권장. 실행 시간 기록
```

---

## pending 조건 이중 정의 (FIX-24)

> **경고:** pending 판정은 **반드시 쌍으로** 수정할 것.

| 변수 | 용도 | 설정 위치 |
|---|---|---|
| `PENDING_COND` | XPath — queryDef (`head` 조회, 폴링) | `00_Config.js` |
| `PENDING_COND_SQL` | SQL — `splitBounds` sqlSelect | `00_Config.js` |

`PENDING_COND_SQL` 은 Config 상수에서만 설정. **외부 입력·vars 조작 금지** — SQL 직접 삽입.
둘 중 하나만 바꾸면 분배(`splitBounds`)와 폴링이 어긋난다.

`updateSampleSent()` 의 `WHERE sapiyn='N'` 은 pending 정의가 아니라 **멱등 UPDATE 가드**이므로 별도.

---

## 무진행 가드 (FIX-25)

| 계층 | 조건 | 동작 |
|---|---|---|
| 워커 `run()` | `lastLine` 3회 연속 무진행 (`NO_PROGRESS_MAX`) | 예외 종료 |
| Factory `02_Polling` | `stallCount >= MAX_STALL`(기본 3) 라운드, `globalProcessed` 증가 없음 | `finish` 강제 |

로그에 `lastLine 무진행` 또는 `연속 처리량 0 → 강제 종료` 가 보이면:

1. `apiYn` 갱신 실패 (`masterId=0`, sqlExec 오류) 의심
2. `lineNo` NULL / 파싱 실패 의심
3. 배포 후 확인 SQL(§배포 후)로 정합성 점검

---

## 산술 분할 전환 (FIX-20-B / 21 / 22)

| 항목 | NTILE (구) | MIN/MAX 산술 분할 (현) |
|---|---|---|
| 분할 방식 | 윈도우 정렬 + NTILE | `MIN/MAX/COUNT` + span 등분 |
| 제거 사유 | 5천만 행 전체 정렬 버퍼 | — |
| `remaining` 상한 | 라인 폭 기준 (부정확) | **밀집도(`density`)** 보정 (FIX-21) |
| 버킷 검증 | 겹침 검사 (항상 통과, 죽은 코드) | **연속성** (`s === prev.e + 1`) (FIX-22) |
| uid 로그 | 등치 `@lineNo=` (경계 미적중) | 범위 조회, **병합 후** 재조회 (FIX-26/28) |

---

## 튜닝 파라미터

| 파라미터 | 기본값 | 소속 | 설명 |
|---|---|---|---|
| `BATCH_SIZE` | `BULK_CFG` | 라이브러리 | queryMembers 1회 fetch 상한 |
| `WORKER_COUNT` | `BULK_CFG` | 라이브러리/Factory | 동시 워커 수·스로틀 분모 |
| `GRAND_TOTAL` | 50,000,000 | `FACTORY_CFG` | 누적 전송 상한 |
| `ROUND_LIMIT` | 0 (= GRAND_TOTAL) | `FACTORY_CFG` | 라운드당 상한 |
| `POLL_WAIT_SEC` | 15 | `FACTORY_CFG` | Factory Wait(초) |
| `MAX_READY` | 5 | `FACTORY_CFG` | ready 상태 재시도 |
| `MAX_RUN` | 360 | `FACTORY_CFG` | 라운드 내 폴링 상한 |
| `MAX_ROUND` | 200 | `FACTORY_CFG` | pending 조회 실패 무한 라운드 방지 |
| `MAX_STALL` | 3 | `FACTORY_CFG` | 연속 무진행 라운드 허용 |

---

## 1. 재배포 목록 (순서대로)

### Phase A — DB/스키마 (Campaign 콘솔 + SQL)

| # | 대상 | 작업 | 파일 |
|---|---|---|---|
| A1 | `wootar:testWooTargetSample` | 스키마 XML 게시 → **구조 업데이트** 마법사 | `schema/testWooTargetSample.xml` |

- idx_queue_pending → **idx_pending_queue** 로 교체 (컬럼 순서 apiYn 선행, FIX-03)
  구조 업데이트 마법사가 기존 인덱스 DROP + 신규 CREATE 를 수행한다.
  5천만 행 기준 인덱스 재생성에 수 분 소요.

| A2 | `wootar:testWooTargetBulkApiMaster` | revLink `targetSample` 추가 → 구조 업데이트 | `schema/testWooTargetBulkApiMaster.xml` |
| A3 | PostgreSQL | 기존 행 apiYn/master 백필 | `sql/01_migration.sql` |
| A4 | PostgreSQL | segId 청크 시딩 (테스트만) | `sql/02_seed_segid.sql` |

### Phase B — JavaScript 라이브러리

| # | Campaign 내부명 | 작업 | 파일 |
|---|---|---|---|
| B1 | `wootar:testWooBulkApiWorker.js` | **재게시** (Detail 제거, BATCH 80k, WORKER 3) | `js/testWooBulkApiWorker.js` |
| B2 | `wootar:testWooBulkApiStatus.js` | **재게시** (STATUS_CPM 스로틀) | `js/testWooBulkApiStatus.js` |

### Phase C — 워크플로우 JS

| # | WF | 활동 | 파일 |
|---|---|---|---|
| C1 | TBAWFactory | `00_Config` | `workflow/factory/00_Config.js` |
| C2 | TBAWFactory | `01_WorkerDistributor` | `workflow/factory/01_WorkerDistributor.js` |
| C3 | TBAWFactory | `02_Polling` | `workflow/factory/02_Polling.js` |
| C4 | TBAW1~3 | worker (변경 없음, B1 재게시만) | `workflow/worker/worker.js` |
| C5 | TBAWStatus | status 00/01/02 (B2 의존) | `workflow/status/*` |

### Phase D — 캔버스 수동 (코드 밖)

| # | WF | 활동 | 변경 |
|---|---|---|---|
| D1 | TBAWFactory | `03_Test` → working Wait | **15초** (기존 30s/1m → 15s) |
| D2 | TBAWStatus | working Wait | 30s 유지 (별도) |
| D3 | TBAWFactory | finish → Status Signal | 유지 (`complete=false`) |
| D4 | TBAW6~15 | — | **중지** (WORKER_COUNT=3) |

---

## 2. 삭제·중단 목록 (즉시 DROP 금지)

### 코드에서 제거됨 (파일은 보존)

| 항목 | 조치 |
|---|---|
| `wootar:testWooTargetBulkApiDetail` 스키마 XML | **파일 유지**. 워커 INSERT 중단 |
| `BULK_CFG.SAVE_SCHEMA` / `saveToDb()` | worker.js에서 삭제 |
| `generateSegId()` | worker.js에서 삭제 → SQL 시딩 |
| Factory `EXACT_COUNT` | 00/01에서 제거 |
| Sample `idx_mt_apiYn_queue`, `idx_sg_planCode` | XML 제거 → **구조 업데이트** 시 ACC가 DROP |

### DB (선택, 안정화 후)

| 항목 | 시점 | SQL 예시 |
|---|---|---|
| Detail 테이블 데이터 | 전송 검증 완료 후 | `DELETE FROM wootartestwootargetbulkapidetail;` |
| Detail 스키마 | 롤백 여유 없을 때 | Campaign에서 스키마 삭제 |

### Campaign WF

| 항목 | 조치 |
|---|---|
| TBAW4~TBAW15 | Start 해제 또는 그대로 두어도 Factory가 3개만 발사 |
| Detail 조회 리포트/워크플로우 | Sample.master FK 조회로 교체 |

---

## 3. 배포 순서 (역순 롤백 가능)

```
0. psql 단독: idx_sample_pending_partial CREATE INDEX CONCURRENTLY + ANALYZE (FIX-23)
   EXPLAIN (ANALYZE, BUFFERS) MIN/MAX/COUNT — Index Only Scan 확인
1. Sample + Master 스키마 구조 업데이트
2. sql/01_migration.sql 실행 (apiYn 백필. 인덱스는 0단계에서 이미 생성)
3. sql/02_seed_segid.sql — need_seg=0·need_backfill=0 확인 후 같은 세션에서 UPDATE
4. B1 → B2 라이브러리 재게시
5. C1~C3 Factory JS 붙여넣기 (00_Config + 01_Distributor 동시 배포 — FIX-24)
6. D1 Factory Wait 15초 변경
7. 스모크 (아래 §5) — bucket line 범위·발사 uid 로그 확인 (FIX-26/28)
8. GRAND_TOTAL 소량 → 행당 바이트 로그 → BATCH_SIZE 조정
9. GRAND_TOTAL=50,000,000 전량
```

### 배포 후 확인 SQL

```sql
-- 전송 완료 정합성. apiYn='Y' 인데 FK 미연결이면 0
SELECT COUNT(*) FROM wootartestwootargetsample
WHERE sapiyn = 'Y' AND imasterid = 0;

-- 잔여 pending 분포. ingestYm 편중 확인
SELECT singestym, COUNT(*) FROM wootartestwootargetsample
WHERE sapiyn = 'N' GROUP BY singestym ORDER BY singestym;

-- Master 실패 배치. errorMessage 로 503/payload 원인 분류
SELECT httpcode, COUNT(*), MIN(serrormessage)
FROM wootartestwootargetbulkapimaster
WHERE isuccess = 0 GROUP BY httpcode;
```

---

## 4. 초기화 / 롤백 SQL

### 전송 큐 초기화 (재테스트)

- 구조 업데이트를 재실행하면 인덱스가 재생성된다. 완료 후 위 4) 로 재확인할 것.
- Sample 초기화는 `UPDATE ... SET sapiyn='N', imasterid=0` 만으로 충분하다.
  Campaign 은 numeric 컬럼에 NULL 을 허용하지 않으므로 0 이 "미연결"의 정상 표현이다.

```sql
UPDATE WootarTestWooTargetSample
   SET sapiyn = 'N', imasterid = 0
 WHERE singestym = '202608';   -- 대상 월
```

### Master만 퍼지 (Sample FK 먼저 끊기)

```sql
-- Sample FK neutral 이므로 Master DELETE 시 imasterid=0 으로 정리되지 않음
-- Master 퍼지 전 Sample 초기화 권장
UPDATE WootarTestWooTargetSample SET imasterid = 0, sapiyn = 'N'
 WHERE imasterid > 0;

DELETE FROM wootartestwootargetbulkapimaster WHERE srunid LIKE '202608%';
```

### 구버전 worker.js 롤백 시

- Detail INSERT 코드가 있는 이전 라이브러리 재게시
- Sample에 `segId`/`master-id` 없어도 구 worker는 동작 (단 generateSegId 복구 필요)

---

## 5. 검증 체크리스트

```sql
-- segId 시딩
SELECT COUNT(*) FROM WootarTestWooTargetSample
 WHERE ssegid IS NULL OR ssegid = '';
-- → 0

-- idx_pending_queue 사용 (구조 업데이트 후)
EXPLAIN SELECT ilineno FROM wootartestwootargetsample
 WHERE sapiyn = 'N' AND singestym = 'YYYYMM' ORDER BY ilineno LIMIT 10;
-- → Index Scan (idx_pending_queue 등)

-- Detail INSERT 차단
SELECT COUNT(*) FROM wootartestwootargetbulkapidetail;
-- → 실행 전후 동일

-- 전송 정합성
SELECT COUNT(*) FROM WootarTestWooTargetSample
 WHERE sapiyn = 'Y' AND (imasterid IS NULL OR imasterid = 0);
-- → 0

-- 유령 성공 없음
SELECT COUNT(*) FROM WootarTestWooTargetSample
 WHERE sapiyn = 'N' AND imasterid > 0;
-- → 실패 재시도 대상만 (의도적)
```

로그 확인:

- `[TBAWx] payload …B / …행 / 행당 …B` → × BATCH_SIZE < 50MB
- `[Polling] Sample pending=0` → finish
- Detail 행 수 불변
- HTTP 503 0회 (STATUS_CPM=5 분리)

---

## 6. BULK_CFG 변경 요약

| 키 | 이전 | 이후 |
|---|---|---|
| `BATCH_SIZE` | 50,000 | **80,000** (메모리·50MB 한도 균형, 로그로 재조정) |
| `WORKER_COUNT` | 5 | **3** |
| `SAFETY_RATIO` | 0.7 | **0.9** |
| `STATUS_CPM` | (없음) | **5** |
| `SPLIT_ON_OVERSIZE` | (없음) | **true** |
| `ERR_MSG_MAX` | 255 | **2000** |

Factory:

| 키 | 이전 | 이후 |
|---|---|---|
| `ROUND_LIMIT` | 500,000 | **0** (= GRAND_TOTAL 단일 라운드) |
| `GRAND_TOTAL` | 5,000,000 | **50,000,000** |
| Wait (캔버스) | 30s~1m | **15s** |

---

## 7. 전송 상태 (단일 진실 공급원)

| apiYn | master-id | 의미 |
|---|---|---|
| N | 0 | 미전송 |
| Y | >0 | 전송 완료, Master 추적 가능 |
| N | >0 | 전송 실패 후 재시도 (직전 배치 참조) |

---

## 8. 스모크 권장값

```
WORKER_COUNT=1, BATCH_SIZE=5000, GRAND_TOTAL=10000, DRY_RUN=true  → 조회/분할만
DRY_RUN=false, GRAND_TOTAL=150000                                  → 소량 실전송
```

**주의:** Phase A 스모크(`test/*`)는 Detail 기준 테스트가 남아 있음. Factory 검증 후 `test/` 갱신은 별도 작업.

---

## 9. 동시 WF 수

| WF | 개수 |
|---|---|
| Factory | 1 |
| Worker | 3 |
| Status | 1 |
| **합계** | **5** (ACC 권고 20 이내) |

---

## 10. 변경 파일 목록

| 경로 | 변경 |
|---|---|
| `schema/testWooTargetSample.xml` | segId, master link, index 정리 |
| `schema/testWooTargetBulkApiMaster.xml` | targetSample revLink |
| `schema/testWooTargetBulkApiDetail.xml` | **변경 없음** |
| `sql/01_migration.sql` | 신규 |
| `sql/02_seed_segid.sql` | 신규 (테스트 시딩) |
| `js/testWooBulkApiWorker.js` | 개편 |
| `js/testWooBulkApiStatus.js` | STATUS_CPM |
| `workflow/factory/00_Config.js` | 개편 |
| `workflow/factory/01_WorkerDistributor.js` | MIN/MAX/COUNT 산술 분할 |
| `workflow/factory/02_Polling.js` | pendingRows |
| `workflow/worker/worker.js` | 변경 없음 |
