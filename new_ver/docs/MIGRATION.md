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

### 5) (선택) 부분 인덱스 — FIX-20-D

전송 완료(`sapiyn='Y'`) 행이 pending 인덱스에서 자동 제외되어 조회가 빨라질 수 있다.
`01_migration.sql` 말미 주석의 DDL을 참고. XML `idx_pending_queue` 와 역할 중복 → EXPLAIN 실측 후 하나만 유지.

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
1. Sample + Master 스키마 구조 업데이트
2. sql/01_migration.sql 실행
3. sql/02_seed_segid.sql — SELECT(0)에서 need_seg=0·need_backfill=0 확인 후 tmp_seg_combo 생성+UPDATE를 **같은 세션**에서 한 문장씩 실행. 완료 후 VACUUM ANALYZE
4. B1 → B2 라이브러리 재게시
5. C1~C3 Factory JS 붙여넣기
6. D1 Factory Wait 15초 변경
7. 스모크 (아래 §5)
8. GRAND_TOTAL 소량 → 행당 바이트 로그 확인 → BATCH_SIZE 조정
9. GRAND_TOTAL=50,000,000 전량
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
| `workflow/factory/01_WorkerDistributor.js` | NTILE |
| `workflow/factory/02_Polling.js` | pendingRows |
| `workflow/worker/worker.js` | 변경 없음 |
