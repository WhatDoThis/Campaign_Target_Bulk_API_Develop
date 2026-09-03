# 세그·큐 적재 — 아이디어 정리 (미확정)

> **상태:** 요구·아키텍처 **미확정**. 구현 착수 전 아이디어·개발 시 필요해 보이는 로직만 정리.
> 확정되면 본 문서를 설계서로 승격하거나 `newLogic.md` / 별도 Runbook에 반영.

관련:

- [newLogic.md](./newLogic.md) — **현행** Factory/Worker (ingestYmd + lineNo 큐, apiYn=N 전송)
- [MIGRATION.md](./MIGRATION.md) — Sample `segId`·`apiYn`
- [../docs/main/01_ProfileApiDataIntegration.md](../../docs/main/01_ProfileApiDataIntegration.md) — Target `seg_id`·빈 값·삭제 불가

---

## 1. 배경 (왜 미들웨어가 필요해 보이는가)

현행 Sample 큐 키는 **적재월일(`ingestYmd`) + 큐일련(`lineNo`)** 이고, 한 행에 **대상자ID(`membershipUid`) + 세그ID(`segId`, 파이프 구분 1컬럼)** 를 담는다.

그러나 소스(CRM·세그 엔진·파일)에서 넘어오는 데이터는 **대상자ID × 세그ID 1개** 형태(1:N 행)일 가능성이 크다.  
Factory/Worker는 **이미 큐 행이 만들어진 Sample** 을 전제로 하므로, **Sample 적재 전·후의 변환 계층(미들웨어)** 이 별도로 필요해 보인다.

또한 “특정 세그(w01)만 빼거나 바꾼 뒤 Target에 다시 반영”은 **segId 컬럼 수정 + (필요 시) 재전송 큐** 문제로, 역시 전송 WF와 분리된 로직 후보다.

---

## 2. 개발 시 필요해 보이는 미들웨어 (2종)

### 2.1 [MW-1] 큐 적재 — UID별 segId 병합 + ingestYmd / lineNo 부여

**역할:** 소스 → Sample(또는 staging) 적재 **직전·직후** 미들웨어.

**입력 (예상):**

| 필드 | 설명 |
|------|------|
| `membershipUid` | 대상자 ID (Target `thirdPartyId`) |
| `segId` (또는 세그 코드 1개) | **행마다 1세그** — 동일 UID 다행 |

**출력 (Sample 큐 1행):**

| 필드 | 설명 |
|------|------|
| `ingestYmd` | 적재월일 (Factory `BIZ_DATE`와 맞출 파티션) |
| `lineNo` | 큐 일련 (1부터, 파티션 내 유니크) |
| `membershipUid` | 대상자 ID |
| `segId` | **UID당 1값** — `w01\|w02\|w03` 파이프 병합 |

**해야 할 일 (개념):**

1. 동일 `membershipUid` 그룹핑
2. 세그 코드 dedupe·정렬 규칙 (예: `w01`~`w99` 오름차순, 중복 제거)
3. `string_agg` / ACC JS join → 255자 `clipSegId` 상한 (`testWooBulkApiWorker.js` 와 동일)
4. `ingestYmd` 부여 (운영일·배치 ID·CRM 지시일 — **미정**)
5. `lineNo` 부여 (파티션 내 단조 증가 — **미정**: UID 정렬 후 순번 vs 적재 순서)

**미정 (착수 전 결정):**

- staging 테이블 유무 vs Sample 직접 INSERT
- 1 UID = 1 행 강제 vs 동일 ingestYmd에 UID 중복 허용 (현행 스키마는 **큐 키가 ingestYmd+lineNo** — UID 중복 가능)
- 병합 전 empty seg·잘못된 코드 처리
- apiYn=N 인 행만 덮어쓸지, 신규 lineNo만 추가할지

**현행과의 관계:** `sql/02_seed_segid.sql` 은 **lineNo % 100 조합 테이블**로 테스트용 일괄 시딩. MW-1은 **운영 소스 형태(UID×seg 다행)** 를 가정한 **일반화 버전** 후보.

---

### 2.2 [MW-2] 다중 세그 수정 — SegPatch Job (아이디어 고도화)

**역할:** **한 번의 Job** 에 **수정 규칙 N개**를 세팅하고, 동일 `ingestYmd` 파티션 안에서 `segId` 를 연쇄 반영한다.  
규칙마다 WF를 수동으로 돌리지 않도록 **Job 단위 1회 실행 → (선택) Factory 1회** 흐름을 목표로 한다.

Target POST는 Job 완료 후 **apiYn=N 으로 되돌린 행**만 기존 Factory/Worker가 재전송 — **연계 방식 미정**.

---

#### 2.2.1 왜 Job + 다중 규칙인가

| 단일 seg 수정 (구 MW-2 초안) | 다중 규칙 Job (고도화) |
|------------------------------|------------------------|
| 규칙 1건 = WF/SQL 1회 수동 | 규칙 N건 = **Job 1회** |
| seg2→seg3, seg3→seg2 등 **교차 변경** 시 순서·누락 위험 | Job 내 **순서(order)** 로 일괄 정의 |
| apiYn 되돌리기를 규칙마다 반복 | **변경된 UID만** 마지막에 apiYn=N **1회** |

---

#### 2.2.2 Job 스코프 (공통)

| 필드 | 설명 |
|------|------|
| `jobId` / `patchRunId` | 작업 식별 (로그·감사) |
| `ingestYmd` | **동일 적재월일** 파티션만 대상 (예: `20260824`) |
| `rules[]` | 순서 있는 규칙 목록 (§2.2.4) |
| `applyMode` | `sequential` \| `batch` — §2.2.6 |
| `resetApiYn` | 변경 행만 `apiYn='N'` (**예시 요구: true**) |
| `scopeFilter` | **미정** — apiYn=Y만 / 전체 / UID 목록 파일 등 |

---

#### 2.2.3 규칙 원语 (Operation) — 후보

토큰 단위 파싱 전제 (`w01` vs `w010` 구분). `triggerSeg` = “이 세그 **보유** 시 규칙 후보”.

| op | 의미 | skip 조건 (예) |
|----|------|----------------|
| `REMOVE` | `triggerSeg` 토큰 제거 | `SKIP_IF_NOT_HAS triggerSeg` |
| `ADD` | `targetSeg` 토큰 추가 | `SKIP_IF_HAS targetSeg` |
| `REPLACE` | `triggerSeg` → `targetSeg` 치환 | `SKIP_IF_NOT_HAS triggerSeg` |
| `REMOVE_ALL_EXCEPT` | **미정** — 화이트리스트만 남김 | — |

규칙 1건 최소 필드 (아이디어):

```
order, op, triggerSeg, targetSeg?, skipIfHas?, skipIfNotHas?
```

---

#### 2.2.4 사용자 예시 → 규칙 매핑

**전제:** `ingestYmd = 20260824` (동일 파티션), Job 1회 실행.

| order | op | triggerSeg | targetSeg | skip | 해석 |
|:-----:|-----|------------|-----------|------|------|
| 1 | `REMOVE` | `seg1` | — | `SKIP_IF_NOT_HAS seg1` | seg1 **있는** 대상에서 seg1 **제거**. 없으면 skip |
| 2 | `ADD` | `seg2` | `seg3` | `SKIP_IF_HAS seg3` | seg2 **있는** 대상에 seg3 **추가**. seg3 이미 있으면 skip |
| 3 | `REMOVE` | `seg3` | `seg2` | `SKIP_IF_NOT_HAS seg2` | seg3 **있는** 대상에서 seg2 **제거**. seg2 없으면 skip |

> order 3 해석: “seg3 이 있는 대상자에게 seg2를 제외(제거)하고, seg2가 이미 없는 대상은 skip”.

**Job YAML/JSON 예 (개념):**

```json
{
  "jobId": "20260903_seg_delta_01",
  "ingestYmd": "20260824",
  "applyMode": "batch",
  "resetApiYn": true,
  "rules": [
    { "order": 1, "op": "REMOVE", "triggerSeg": "seg1", "skipIfNotHas": "seg1" },
    { "order": 2, "op": "ADD",    "triggerSeg": "seg2", "targetSeg": "seg3", "skipIfHas": "seg3" },
    { "order": 3, "op": "REMOVE", "triggerSeg": "seg3", "targetSeg": "seg2", "skipIfNotHas": "seg2" }
  ]
}
```

(`REMOVE` 의 `targetSeg` 는 “제거할 토큰” 의미로 재사용 — **필드명은 구현 시 `removeSeg` 로 분리 검토**)

---

#### 2.2.5 처리 흐름 (1 Job)

```
[SegPatch Job 시작]
  ingestYmd 파티션 Sample 행 로드 (또는 UID별 1행으로 정규화 — T6)
        |
        v
  for each row (또는 each UID):
        tokens = parse(segId)
        changed = false
        for each rule in rules (order ASC):
              if skip 조건 → continue (이 규칙 skip, changed 아님)
              tokens' = apply(op, tokens, rule)
              if tokens' != tokens → changed = true; tokens = tokens'
        newSegId = join(tokens)
        |
        v
  UPDATE Sample SET segId=newSegId
        WHERE (ingestYmd, lineNo) AND newSegId != oldSegId
        |
        v
  if resetApiYn:
        UPDATE ... SET apiYn='N'  -- 변경된 행만 (skip 제외)
        (master-id 정책 — T4 미정: 0 유지 vs NULL 불가로 0)
        |
        v
[Job 종료] → (운영) TBAW Factory 1회 — pending=apiYn=N 재전송
```

**변경 판정:** 규칙 전체를 적용한 **최종 segId ≠ Job 시작 시 segId** 인 행만 “수정됨”.  
규칙 단위로 전부 skip 된 행은 **UPDATE·apiYn 변경 없음**.

---

#### 2.2.6 applyMode — 순차 vs 일괄

| 모드 | 동작 | 얡기 |
|------|------|------|
| **`batch` (권장)** | UID당 segId **한 벌** 로드 → 규칙 1..N **메모리에서 연쇄** → **UPDATE 1회** | DB 왕복 최소, Job 원자성에 유리 |
| **`sequential`** | 규칙 1 전체 UPDATE → 규칙 2 전체 UPDATE → … | 규칙마다 DB 스캔. 디버깅·중간 커밋용 |

동일 Job·동일 규칙 순서면 **최종 segId 는 batch = sequential 이론상 동일** (한 UID에 규칙이 겹칠 때만 order 중요).

**교차 규칙 예:** order 2에서 seg3 추가, order 3에서 seg3 보유자 seg2 제거 — **batch** 가 order 2→3 연쇄를 한 UID 안에서 처리.

---

#### 2.2.7 apiYn=N 되돌리기 (예시 요구 반영)

| 항목 | 아이디어 |
|------|----------|
| 대상 | **segId 가 실제로 바뀐 행만** (skip-only 행 제외) |
| `apiYn` | `'N'` (미전송) |
| `master-id` | **T4 미정** — 0 유지(직전 배치 참조) vs 재전송 시 덮어쓰기 |
| Factory | Job **1회** 후 **BIZ_DATE=ingestYmd** Factory **1회** — 수동 N번 WF 불필요 |

이미 Target에 Y 로 올라간 행도 segId 수정 + apiYn=N 이면 **현행 Factory pending 큐에 재진입** (별도 Patch WF 없이 가능할 **수 있음** — 멱등·master 정책은 T4).

---

#### 2.2.8 UID·행 단위 (MW-1/MW-2 경계)

| 모델 | Job 적용 단위 | 비고 |
|------|---------------|------|
| **A. lineNo 행 단위** | `(ingestYmd, lineNo)` 각각 규칙 적용 | 현행 큐 키와 일치 |
| **B. UID 단위** | 동일 ingestYmd 내 **같은 UID 모든 행** 동일 segId 로 맞춤 | CRM 관점 자연스러움 |

**미정 (T6):** 운영에서 1 UID = 1 active 행을 MW-1에서 강제할지, Job은 B로 UID 통합 후 1행만 apiYn=N 할지.

---

#### 2.2.9 Target API·데이터 전제 (변경 없음)

- remove = **토큰 제거 후 전체 문자열** 재전송 (빈 값 삭제 아님)
- Job 결과 `segId` = 다음 Bulk POST payload
- “기존 반영 목록” 원본: `Sample.segId` vs `sentSegId` — **T3 미정** (Y 행 remove 시 sentSegId 가 더 안전할 **수 있음**)

---

#### 2.2.10 MW-2 단일 seg 버전과의 관계

| | 단일 seg (구 §2.2 초안) | SegPatch Job (고도화) |
|---|-------------------------|------------------------|
| 설정 | targetSeg 1개 + op 1개 | **rules[] N개** |
| 실행 | SQL/WF N회 | **Job 1회** |
| apiYn | 규칙마다? | **변경 행 일괄 N** |
| 구현 | `06_patchSegId.js` 1규칙 | `06_runSegPatchJob.js` + Job 정의 테이블/JSON |

단일 seg 는 **rules 1개짜리 Job** 으로 특수화 가능 → 별도 코드 경로 불필요.

**미정 (잔여):**

- Job 정의 저장: ACC `xtk:option` / 전용 테이블 / WF vars / 외부 JSON
- 속성(`planName` 등) 세그 조건부 수정 → Job `attrRules[]` 확장 vs MW-3
- Job 실패 시 롤백·dryRun·변경 건수 리포트

---

## 3. 미들웨어와 현행 파이프라인 위치

```
[소스: UID × seg 행들]
        |
        v
   +-----------+
   |  MW-1     |  UID별 seg 병합, ingestYmd, lineNo
   +-----------+
        |
        v
   Sample (apiYn=N, segId=파이프 1개)
        |
        +-- (일반 적재) --> TBAW Factory / Worker  [현행]
        |
        +-- (세그 변경) --> +-------------------+
                            |  MW-2 SegPatch Job |  rules[] N건, ingestYmd 1파티션
                            +-------------------+
                                    |
                                    v
                            segId UPDATE + 변경행 apiYn=N
                                    |
                                    v
                            TBAW Factory 1회 (재전송 — 미정)
```

**현행 개발 범위 밖:** MW-1·MW-2는 **아직 코드·WF·스키마 없음**. 만들 **수도** 있는 후보.

---

## 4. 아직 정해지지 않은 것 (TBD 목록)

| # | 항목 |
|---|------|
| T1 | MW-1/MW-2를 ACC WF vs 외부 ETL vs SQL 스크립트 중 어디에 둘지 |
| T2 | Patch 전용 테이블 vs Sample 컬럼만으로 처리할지 |
| T3 | `sentSegId` (마지막 Target POST 스냅샷) 도입 여부 |
| T4 | apiYn=Y 대상 재전송 시 apiYn/master-id 정책 |
| T5 | 세그 코드 네이밍·정렬·대소문자·255자 초과 시 truncate vs split 행 |
| T6 | UID 1명 1행 vs 다행 허용 (운영 규칙) |
| T7 | 특정 세그만 **추가 속성** — MW-2 확장 vs 별도 모듈 |
| T8 | CRM 연동 주기·patchRunId(작업 ID) 명명 |
| T9 | SegPatch Job 정의 저장소 (JSON / ACC 테이블 / WF vars) |
| T10 | `applyMode` 기본값 batch vs sequential |
| T11 | Job dryRun·변경 건수 리포트·롤백 |
| T12 | 규칙 op 확장 (`REPLACE`, `REMOVE_ALL_EXCEPT`) 필요 여부 |

---

## 5. 참고 — 이전 논의 메모 (결정 아님)

아래는 세그 델타 요구 검토 시 나온 **참고 의견**이며, 확정 설계가 아니다.

- **Tier 1 (현행):** ingestYmd 큐 + apiYn=N 초기 Bulk 적재 — **유지 가정**
- **Tier 2 (후보):** Patch 큐 + 별도 Factory, `BulkApiWorker` 재사용 — **만들지 미정**
- **전송 전(apiYn=N):** MW-2로 segId만 고치면 Factory 추가 없이 가능할 **수 있음**
- **전송 후(apiYn=Y):** MW-2 + 재전송 경로가 **추가로** 필요해 보임
- IdxCheck·Distributor head `sqlSelect` 등 **현행 Factory 최적화**는 본 아이디어와 독립

상세 아키텍처 스케치(Patch 스키마, Phase 로드맵)가 필요해지면 그때 §6을 설계서로 확장.

---

## 6. new_ver 반영 후보 (구현 시 — 지금은 착수 안 함)

| 후보 파일 | MW | 비고 |
|-----------|-----|------|
| `sql/05_mergeSegQueue.js` (가칭) | MW-1 | UID×seg → Sample INSERT/UPDATE |
| `sql/06_runSegPatchJob.js` (가칭) | MW-2 | Job + rules[] 일괄 적용, apiYn=N |
| `schema/testWooSegPatchRule.xml` (가칭) | MW-2 | Job/Rule 영속 — **미정** |
| `js/testWooSegQueueMiddleware.js` (가칭) | MW-1/2 | `parseSegTokens`, `applyRule`, `runJob` |
| Sample `sentSegId` 컬럼 | MW-2 보조 | 전송 후 remove 원본 — **미정** |

---

## 7. 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-09-03 | 초안 — 세그 델타 판단·Patch Tier 논의 |
| 2026-09-03 | **MW-2 고도화** — SegPatch Job, 다중 규칙·batch/sequential·apiYn=N 일괄 |
