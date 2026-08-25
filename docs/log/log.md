# Log

## Log Index

69. 2026-08-25 GitHub Develop 리모트 동기화
68. 2026-08-25 설정 소유권 정리 — SMOKE_CFG / FACTORY_CFG / BULK_CFG 분리
67. 2026-08-25 FIX-45~50 설정 소유권 Factory/BULK_CFG 재배치
66. 2026-08-25 GitHub Develop 리모트 동기화
65. 2026-08-25 FIX-40~44 Factory Distributor·Polling 치명 결함 수정
64. 2026-08-25 GitHub Develop 리모트 동기화
63. 2026-08-25 Factory·Worker 운영 고도화
62. 2026-08-25 GitHub Develop 리모트 동기화
61. 2026-08-25 FIX-33~39 스모크·라이브러리 결함 수정
60. 2026-08-25 GitHub Develop 리모트 동기화
59. 2026-08-25 스모크·Factory ingestYmd/BIZ_DATE/GRAND_TOTAL 정합
58. 2026-08-25 GitHub Develop 리모트 동기화
57. 2026-08-24 라이브러리 ingestYmd + BIZ_DATE 기준일 전환
56. 2026-08-24 Sample 큐 키 ingestYm → ingestYmd(YYYYMMDD) 스키마·마이그레이션 SQL
55. 2026-08-24 스모크 T2 Member probe queryDef 페이징 수정
54. 2026-08-24 saveMaster lastModified formatDate 패턴 수정 (스모크 -53)
53. 2026-08-24 GitHub Develop 리모트 동기화
52. 2026-08-24 FIX-21~29 — 산술 분할 후속 결함 정리 및 가드 보강
51. 2026-08-24 FIX-24~26 : PENDING_COND_SQL 단일화·무진행 가드·uid 범위 조회
50. 2026-08-24 FIX-21~23 : splitBounds 밀집도 보정·연속성 검증·부분 인덱스 필수
49. 2026-08-24 new_ver 전체 히스토리형 주석 → 기능·가드레일 설명 정리
48. 2026-08-24 GitHub Develop 리모트 동기화
47. 2026-08-24 FIX-15~20 : sqlSelect 시그니처 / sqlExec 반환값 / 고아 버킷 인접 병합 / BATCH_SIZE / 시딩 SQL / 잔여 최적화
46. 2026-08-24 GitHub Develop 리모트 동기화
45. 2026-08-24 검수 결함 수정 (NTILE LIMIT·폴링 count·인덱스 순서)
44. 2026-08-24 GitHub Develop 리모트 동기화
43. 2026-08-21 segId 시딩 SQL ACC 리터럴 구간화
42. 2026-08-21 스모크 테스트 Sample FK 전환
41. 2026-08-21 migration SQL ACC 방식으로 수정
40. 2026-08-21 Sample XML dbindex 정리
39. 2026-08-21 Detail 폐기 Sample FK 전송 최적화
38. 2026-08-21 Status WF Test/Wait 캔버스 가이드
37. 2026-08-21 GitHub Develop 리모트 동기화
36. 2026-08-21 batchStatus 재조회 잡을 분리
35. 2026-08-21 배치 5만·planName·POLL_MAX=0
34. 2026-08-21 Factory-라이브러리 설정 중복 제거
33. 2026-08-21 Factory를 큐 키 시그널로 업그레이드
32. 2026-08-21 스모크 설정을 BULK_CFG 단일 소스로 정리
31. 2026-08-20 스모크 5천만 count 제거·큐 백필 SQL
30. 2026-08-20 Sample 큐 컬럼 notNull 제거 (PGS-220000)
29. 2026-08-20 Sample·Detail에서 UID 유니크 제거
28. 2026-08-20 전송 큐 키 ingestYm+lineNo (Phase A)
27. 2026-08-20 GitHub Develop 리모트 동기화
26. 2026-08-20 Factory 분할을 UID 오름차순 offset 으로 변경
25. 2026-08-20 Factory에서 ENABLED·DRY_RUN 제거
24. 2026-08-20 GitHub Develop 리모트 동기화
23. 2026-08-20 워커 상한을 15로 변경
22. 2026-08-20 Factory/Worker 주석·가드레일 보강
21. 2026-08-20 Factory 운영 구현과 동시 워커 스로틀
20. 2026-08-20 T3 링크를 [@master-id]와 [master/@id] 둘 다 확인
19. 2026-08-20 T3 링크 조회를 [@master-id]로 교정
18. 2026-08-20 T3 Detail→Master 링크 판정을 SQL로 교정
17. 2026-08-20 urlPermission 차단 시 done 오보고 수정
16. 2026-08-19 2차 스모크 T3 링크·Test 분기 수정
15. 2026-08-19 1차 스모크 로그 원인 수정
14. 2026-08-19 기본 스모크에 샘플 UID 소수 실전송
13. 2026-08-19 스모크를 라이브러리 계약으로 재작성
12. 2026-08-19 AUTH_TOKEN을 Profile API UI 경로로 명시
11. 2026-08-19 라이브러리 xtk:option 조회 제거
10. 2026-08-19 GitHub Develop 리모트 최초 푸시
9. 2026-08-19 Profile API 가이드에 가드레일 명시
8. 2026-08-19 CUSTOM_ATTR 가변 프로필 컬럼
7. 2026-08-19 BulkApiWorker 재검수 — enum/HTTP/컬럼길이 가드
6. 2026-08-19 BulkApiWorker 검수 항목 반영 (인증·escape·batchStatus)
5. 2026-08-19 new_ver Logic 정리 및 라이브러리·스키마 검수
4. 2026-08-19 Profile API 연동 가이드에 조회 API 섹션 추가
3. 2026-08-19 문서 흐름도를 mermaid에서 ASCII로 전환
2. 2026-08-19 old_ver Logic에 스키마 명세와 로그 보완 속성 추가
1. 2026-08-19 old_ver Logic 보강 및 Profile API 연동 설명서 작성

## Log Body

69. 2026-08-25 GitHub Develop 리모트 동기화
Purpose: SMOKE_CFG/FACTORY_CFG/BULK_CFG 설정 소유권 분리를 origin/main에 올린다.
Changes:

- BULK_CFG 정리, 스모크·Factory·worker 시그널 필수화, STATUS_CFG 분리
Changed files: docs/log/log.md, new_ver/js/*.js, new_ver/test/*.js, new_ver/workflow/**

68. 2026-08-25 설정 소유권 정리 — SMOKE_CFG / FACTORY_CFG / BULK_CFG 분리
Purpose: 스모크·Factory 튜닝값을 라이브러리 BULK_CFG 에서 분리하고 v1.0 코드에서 히스토리형 주석 제거.
Changes:

- BULK_CFG: BATCH_SIZE/WORKER/CUSTOM_ATTR/CPM 등 Factory·스모크 전용 항목 삭제
- BulkApiWorker: batchSize·workerCount·customAttr·레이트 파라미터 시그널 필수, BULK_CFG fallback 제거
- 01_SmokeConfig: SMOKE_* 배분·레이트·속성 정의 및 instance.vars 전파
- Factory 00/01/worker: FACTORY_CFG 단일 소스, PostEvent 레이트 필드 추가
- testWooBulkApiStatus: STATUS_CPM/SAFETY_RATIO 를 STATUS_CFG 로 이동
- workflow·test·js 전역 (변경)/FIX-XX/고도화 주석 제거
Changed files: new_ver/js/testWooBulkApiWorker.js, new_ver/js/testWooBulkApiStatus.js, new_ver/workflow/factory/00_Config.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js, new_ver/workflow/worker/worker.js, new_ver/workflow/status/00_Config.js, new_ver/test/01_SmokeConfig.js, new_ver/test/02_SmokeLocal.js, new_ver/test/03_SmokeFire.js, new_ver/test/05_SmokeApiTest.js, new_ver/test/06_SmokeVerify.js, new_ver/test/07_SmokeSignalWorker.js, docs/log/log.md

67. 2026-08-25 FIX-45~50 설정 소유권 Factory/BULK_CFG 재배치
Purpose: WORKER/BATCH/CUSTOM_ATTR/레이트 예산을 FACTORY_CFG 로 이동, BULK_CFG.BIZ_DATE 제거.
Changes:

- 00_Config: FACTORY_CFG 확장, pick() 우선 해석, ROUND_CAP clamp, vars 전파
- testWooBulkApiWorker: calcThrottleMs(ovr), resolveBizDate 단순화, pickP batch/customAttr
- 01 PostEvent batchSize/customAttr, worker resolveSignalParams 동기화
- 01_SmokeConfig BIZ_DATE 주석 정리
Changed files: new_ver/workflow/factory/00_Config.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/worker/worker.js, new_ver/js/testWooBulkApiWorker.js, new_ver/test/01_SmokeConfig.js, docs/log/log.md

66. 2026-08-25 GitHub Develop 리모트 동기화
Purpose: FIX-40~44 Factory Distributor·Polling 치명 결함 수정을 origin/main에 올린다.
Changes:

- splitBounds 보정, runId 즉시 전파, pollCount 리셋, stall 로그 보강
Changed files: docs/log/log.md, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js

65. 2026-08-25 FIX-40~44 Factory Distributor·Polling 치명 결함 수정
Purpose: 첫 라운드 throw·STRICT runId·pollCount 누적·stall 오탐 등 Factory 중단 결함 제거.
Changes:

- FIX-40: 병합 후 불연속 throw → 경계 보정+경고
- FIX-41: splitBounds 조기 break·버킷 불연속 보정
- FIX-42: instance.vars.runId 라운드 시작 즉시 전파
- FIX-43: pollCount·readyRetry 라운드 시작 리셋
- FIX-44: stall 종료 로그에 워커상태·skip 안내
Changed files: new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js, docs/log/log.md

64. 2026-08-25 GitHub Develop 리모트 동기화
Purpose: Factory·Worker 운영 고도화(sessionRunId·failed 집계·시그널 가드)를 origin/main에 올린다.
Changes:

- 00 sessionRunId/pendingStartCnt, 02 종료 배너, worker resolveSignalParams
Changed files: docs/log/log.md, new_ver/js/testWooBulkApiWorker.js, new_ver/workflow/factory/*.js, new_ver/workflow/worker/worker.js

63. 2026-08-25 Factory·Worker 운영 고도화
Purpose: ingestYmd 운영 전 Factory/Worker 가시성·시그널 안정성·집계 강화.
Changes:

- 00_Config: sessionRunId, pendingStartCnt, MEMBER_TABLE 폴백, PENDING_COND_SQL lineNo>=1
- 01: splitBounds pending cnt/line 로그, roundPendingCap
- 02: failed 누적·라운드/종료 요약 배너
- worker.js: resolveSignalParams 명시 추출, 필수 vars 가드, 배치 로그
- BULK_CFG.MEMBER_TABLE → wootartestwootargetsample
Changed files: new_ver/workflow/factory/00_Config.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js, new_ver/workflow/worker/worker.js, new_ver/js/testWooBulkApiWorker.js, docs/log/log.md

62. 2026-08-25 GitHub Develop 리모트 동기화
Purpose: FIX-33~39 스모크·라이브러리 결함 수정을 origin/main에 올린다.
Changes:

- lastModified bulkTs/smkTs, Cleanup apiYn 유지, BATCH_SIZE 상한 100k
Changed files: docs/log/log.md, new_ver/js/testWooBulkApiWorker.js, new_ver/schema/testWooTargetSample.xml, new_ver/test/*.js

61. 2026-08-25 FIX-33~39 스모크·라이브러리 결함 수정
Purpose: TIM-030009 lastModified, toXMLString, FK/Cleanup 중복전송·패턴 불일치 등 스모크 결함 정리.
Changes:

- FIX-33: smkTs/bulkTs — lastModified 직접 조립 (02, saveMaster)
- FIX-34: 07 dumpVars — vars.toXMLString 제거
- FIX-35: 02 T3 FK 검증 후 try/catch 원복
- FIX-36: 06 Cleanup apiYn=Y 유지, imasterid만 0
- FIX-37: 06 DeleteCollection 하이픈 패턴 통일
- FIX-38: 02/06 MEM_TBL 폴백 wootartestwootargetsample
- FIX-39: 01 BATCH_SIZE 상한 100000
Changed files: new_ver/js/testWooBulkApiWorker.js, new_ver/test/01_SmokeConfig.js, new_ver/test/02_SmokeLocal.js, new_ver/test/06_SmokeVerify.js, new_ver/test/07_SmokeSignalWorker.js, docs/log/log.md

60. 2026-08-25 GitHub Develop 리모트 동기화
Purpose: 스모크·Factory ingestYmd/BIZ_DATE/GRAND_TOTAL 정합을 origin/main에 올린다.
Changes:

- test 01~07 ingestYmd·bizDate PostEvent, Factory pending BIZ_DATE 스코프
Changed files: docs/log/log.md, new_ver/test/*.js, new_ver/workflow/factory/*.js, new_ver/workflow/worker/worker.js

59. 2026-08-25 스모크·Factory ingestYmd/BIZ_DATE/GRAND_TOTAL 정합
Purpose: Step 3·4 — test/workflow를 일 단위 ingestYmd·BIZ_DATE·GRAND_TOTAL 계약에 맞춘다.
Changes:

- test 02~07: ingestYmd/smkRealYmd/singestymd, PostEvent bizDate+ingestYmd
- Factory 01: head 8자리 검증, splitBounds PENDING_COND_SQL 단일, PostEvent bizDate
- Factory 02: pending 잔량 조회에 PENDING_COND(BIZ_DATE 스코프)
- worker.js: ingestYmd·bizDate 로그
Changed files: new_ver/test/02_SmokeLocal.js, new_ver/test/03_SmokeFire.js, new_ver/test/05_SmokeApiTest.js, new_ver/test/06_SmokeVerify.js, new_ver/test/07_SmokeSignalWorker.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js, new_ver/workflow/worker/worker.js, docs/log/log.md

58. 2026-08-25 GitHub Develop 리모트 동기화
Purpose: ingestYmd 큐 키 전환·BIZ_DATE·스모크/Master 수정을 origin/main에 올린다.
Changes:

- Sample ingestYm→ingestYmd, 03_migrate_ingestYmd.sql, BULK_CFG.BIZ_DATE
- saveMaster formatDate, T2 probe 페이징, TestResult 고도화 1차
Changed files: docs/log/log.md, new_ver/docs/TestResult.md, new_ver/js/testWooBulkApiWorker.js, new_ver/schema/*, new_ver/sql/*, new_ver/test/02_SmokeLocal.js

57. 2026-08-24 라이브러리 ingestYmd + BIZ_DATE 기준일 전환
Purpose: 실운영 일 단위 큐·Factory 기준일 스코프를 워커 라이브러리에 반영.
Changes:

- BULK_CFG.BIZ_DATE 추가 (빈값=오늘 YYYYMMDD, hardcode 가능)
- BulkApiWorker.resolveBizDate / resolveIngestYmd
- queryMembers·updateSampleSent: @ingestYmd / singestymd
- ingestYmd !== BIZ_DATE 가드
Changed files: new_ver/js/testWooBulkApiWorker.js, docs/log/log.md

56. 2026-08-24 Sample 큐 키 ingestYm → ingestYmd(YYYYMMDD) 스키마·마이그레이션 SQL
Purpose: 실운영 일 단위 적재·Factory 기준일 스코프를 위해 큐 키를 적재월일로 전환. ACC 구조 업데이트·백필 절차 정리.
Changes:

- testWooTargetSample: ingestYm 제거, ingestYmd(length 8) + queueLine·idx_pending_queue 갱신
- testWooTargetBulkApiDetail: ingestYmd 동기 (Detail 폐기, 스키마만)
- sql/03_migrate_ingestYmd.sql: ACC 공식 절차·백필·partial index(singestymd) 재생성
- backfillSampleQueue.sql: singestymd YYYYMMDD 기준
Changed files: new_ver/schema/testWooTargetSample.xml, new_ver/schema/testWooTargetBulkApiDetail.xml, new_ver/schema/backfillSampleQueue.sql, new_ver/sql/03_migrate_ingestYmd.sql, new_ver/sql/01_migration.sql, docs/log/log.md

55. 2026-08-24 스모크 T2 Member probe queryDef 페이징 수정
Purpose: lineCount=1 만으로 uid 빈값 → Verify 누적 FAIL. startLine=1 + orderBy 로 1행 확보.
Changes:

- 02_SmokeLocal T2 Member 조회 probe에 startLine·orderBy 추가
Changed files: new_ver/test/02_SmokeLocal.js, docs/log/log.md

54. 2026-08-24 saveMaster lastModified formatDate 패턴 수정 (스모크 -53)
Purpose: TIM-030009 — lastModified 값 202608-24 형식으로 Master Write 실패.
Changes:

- saveMaster formatDate %4Y%2M-%2D → %4Y-%2M-%2D (T3·Status 와 동일)
Changed files: new_ver/js/testWooBulkApiWorker.js, docs/log/log.md

53. 2026-08-24 GitHub Develop 리모트 동기화
Purpose: FIX-21~29 산술 분할·가드·부분 인덱스·주석 정리를 origin/main에 올린다.
Changes:

- splitBounds 밀집도 보정, 무진행/stall 가드, PENDING_COND_SQL 단일화
- 부분 인덱스 필수, MIGRATION·스모크·Status WF 동기화
Changed files: docs/log/log.md, new_ver/docs/MIGRATION.md, new_ver/js/*.js, new_ver/schema/testWooTargetSample.xml, new_ver/sql/*.sql, new_ver/test/*.js, new_ver/workflow/**

52. 2026-08-24 FIX-21~29 — 산술 분할 후속 결함 정리 및 가드 보강
Purpose: FIX-20-B NTILE 제거 후 파생 결함·무한 루프 공백 정리, 문서·Config 일원화.
Changes:

- FIX-21 [CRITICAL] splitBounds COUNT(*) + density 기반 remaining 환산
- FIX-22 [HIGH] 버킷 검증 겹침 → 연속성
- FIX-23 [HIGH] idx_sample_pending_partial 필수 승격 (psql CONCURRENTLY)
- FIX-24 [MEDIUM] PENDING_COND_SQL, splitBounds SQL 단일 소스
- FIX-25 [MEDIUM] 워커 lastLine 무진행 + 팩토리 stallCount 조기 finish
- FIX-26 [MEDIUM] fetchUidFromLine 범위 조회
- FIX-27 [LOW] MAX_ROUND / MAX_STALL Config 이관
- FIX-28 [LOW] 발사 로그 uid 병합 후 재조회 (su/eu stale 제거)
- FIX-29 [DOC] MIGRATION.md 갱신
Changed files: new_ver/workflow/factory/00_Config.js, 01_WorkerDistributor.js, 02_Polling.js, new_ver/js/testWooBulkApiWorker.js, new_ver/sql/01_migration.sql, new_ver/docs/MIGRATION.md, docs/log/log.md

51. 2026-08-24 FIX-24~26 : PENDING_COND_SQL 단일화·무진행 가드·uid 범위 조회
Purpose: pending 조건 이중 정의 제거, 워커/팩토리 무진행 루프 방어, 산술 분할 버킷 uid 로그 적중률 개선.
Changes:

- FIX-24: PENDING_COND / PENDING_COND_SQL Config 쌍, splitBounds SQL 단일 소스
- FIX-25: run() NO_PROGRESS_MAX, 02_Polling stallCount>=3 finish
- FIX-26: fetchUidFromLine 범위 조회, 버킷당 2회→1회
Changed files: new_ver/workflow/factory/00_Config.js, 01_WorkerDistributor.js, 02_Polling.js, new_ver/js/testWooBulkApiWorker.js, docs/log/log.md

50. 2026-08-24 FIX-21~23 : splitBounds 밀집도 보정·연속성 검증·부분 인덱스 필수
Purpose: 산술 분할 시 remaining 과소/과대 추정 수정, 의미 없는 겹침 검증을 연속성 검증으로 교체, COUNT 성능을 위한 partial index 필수화.
Changes:

- FIX-21: splitBounds SQL에 COUNT(*), density 기반 effHi 보정
- FIX-22: bounds/liveJobs 겹침 검증 → lineNo 연속성 검증
- FIX-23: idx_sample_pending_partial CREATE INDEX CONCURRENTLY 실행문 승격 (psql 단독)
Changed files: new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/sql/01_migration.sql, docs/log/log.md

49. 2026-08-24 new_ver 전체 히스토리형 주석 → 기능·가드레일 설명 정리
Purpose: (변경)·FIX·Phase·폐기 등 변경 이력 주석 제거. 기능 설명·가드레일만 남김.
Changes:

- testWooBulkApiWorker.js: Master/로그 스키마·queryMembers·updateSampleSent 등 기능 주석
- Factory·Status·Smoke·SQL·Sample XML: (변경) 제거, 인덱스·WF state·cleanup 등 가드레일로 교체
Changed files: new_ver/js/testWooBulkApiWorker.js, new_ver/js/testWooBulkApiStatus.js, new_ver/workflow/factory/*.js, new_ver/workflow/status/01_StatusGet.js, new_ver/workflow/worker/worker.js, new_ver/test/*.js, new_ver/sql/*.sql, new_ver/schema/testWooTargetSample.xml, docs/log/log.md

48. 2026-08-24 GitHub Develop 리모트 동기화
Purpose: FIX-15~20 검수 수정( sqlSelect/sqlExec·고아 버킷·BATCH 80k·MIN/MAX 분할)을 origin/main에 올린다.
Changes:

- sqlSelect(format,query)·sqlExec 반환값 검증, 인접 고아 버킷 병합
- NTILE→MIN/MAX splitBounds, BATCH_SIZE 80k, segId CROSS JOIN 시딩
Changed files: docs/log/log.md, new_ver/docs/MIGRATION.md, new_ver/js/testWooBulkApiWorker.js, new_ver/sql/*.sql, new_ver/test/05_SmokeApiTest.js, new_ver/workflow/factory/*.js

47. 2026-08-24 FIX-15~20 : sqlSelect 시그니처 / sqlExec 반환값 / 고아 버킷 인접 병합 / BATCH_SIZE / 시딩 SQL / 잔여 최적화
Purpose: sqlSelect/sqlExec 오용 수정, 고아 버킷 겹침 방지, 메모리·시딩·스모크·분할 최적화.
Changes:

- FIX-15: sqlSelect(format, query) 시그니처 준수, rs.row.length() 판정
- FIX-16: sqlExec 반환값으로 UPDATE 검증, 역조회 COUNT는 fallback만
- FIX-17: 고아 버킷 인접 병합 + 정렬 + 겹침 재검증
- FIX-18: BATCH_SIZE 150000→80000, 스로틀 주석 4,445ms 정정
- FIX-19: 02_seed_segid CROSS JOIN+row_number, need_backfill 점검
- FIX-20: MIN/MAX 분할, 스모크 scond 인덱스 선행, MAX_ROUND=200, 부분 인덱스 DDL 주석, MIGRATION 갱신
Changed files: new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/js/testWooBulkApiWorker.js,
  new_ver/workflow/factory/02_Polling.js, new_ver/test/05_SmokeApiTest.js, new_ver/sql/02_seed_segid.sql,
  new_ver/sql/01_migration.sql, new_ver/docs/MIGRATION.md, docs/log/log.md

46. 2026-08-24 GitHub Develop 리모트 동기화
Purpose: 검수 결함 수정(NTILE·폴링·인덱스·스로틀·스모크)을 origin/main에 올린다.
Changes:

- NTILE LIMIT 위치·고아 버킷 이월, pending 존재 확인, idx_pending_queue
- calcThrottleMs 단일화, segId 시딩 조합 테이블, MIGRATION 실행 전 SQL
Changed files: docs/log/log.md, new_ver/docs/MIGRATION.md, new_ver/js/testWooBulkApiWorker.js, new_ver/schema/testWooTargetSample.xml, new_ver/sql/02_seed_segid.sql, new_ver/test/*.js, new_ver/workflow/factory/*.js

45. 2026-08-24 검수 결함 수정 (NTILE LIMIT·폴링 count·인덱스 순서)
Purpose: 코드 검수에서 발견된 구간 소실·타임아웃·인덱스 미스매치를 수정한다.
Changes:

- 01_Distributor: NTILE LIMIT 위치 교정(윈도우 함수 선평가), 버킷 경계 검증, 고아 버킷 이월
- 02_Polling: 5천만 count 제거(존재 확인 전환), 분기 순서 교정(dead branch 제거)
- Sample XML: idx_pending_queue 로 교체. apiYn 선행
- worker: updateSampleSent 갱신 역조회 검증, calcThrottleMs 단일화, DRY 배치명 표식
- test: 05 Master element 하드코딩 제거, 06 과잉 삭제 제거·조건 순서 정렬
- sql: 02_seed_segid 조합 테이블 방식(md5 25억→5천회)
- docs: MIGRATION 실행 전 확인 SQL 4종, state 주석 통일
Changed files: new_ver/js/testWooBulkApiWorker.js, new_ver/workflow/factory/00_Config.js,
  new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js,
  new_ver/schema/testWooTargetSample.xml, new_ver/sql/02_seed_segid.sql,
  new_ver/test/03_SmokeFire.js, new_ver/test/05_SmokeApiTest.js,
  new_ver/test/06_SmokeVerify.js, new_ver/docs/MIGRATION.md, docs/log/log.md

44. 2026-08-24 GitHub Develop 리모트 동기화
Purpose: Detail 폐기·Sample FK 전송·마이그레이션 SQL·스모크/Factory 갱신을 origin/main에 올린다.
Changes:

- Sample segId+master FK, NTILE Factory, BATCH 150k, MIGRATION.md·sql/
- Detail/generateSegId 제거, 스모크 Sample FK 전환
Changed files: docs/log/log.md, new_ver/docs/MIGRATION.md, new_ver/js/*.js, new_ver/schema/*.xml, new_ver/sql/*.sql, new_ver/test/*.js, new_ver/workflow/factory/*.js

43. 2026-08-21 segId 시딩 SQL ACC 리터럴 구간화
Purpose: ACC SQL 활동은 `:start` 바인드 미지원 → backfillSampleQueue.sql 과 동일 패턴으로 수정.
Changes:

- 02_seed_segid.sql: membershipUid 500만 건×10 + 잔여, 상태/검증 SELECT
- MIGRATION.md A4 실행 안내 보강
Changed files: new_ver/sql/02_seed_segid.sql, new_ver/docs/MIGRATION.md, docs/log/log.md

42. 2026-08-21 스모크 테스트 Sample FK 전환
Purpose: Detail/generateSegId 제거 아키텍처에 맞게 Phase1 스모크 갱신.
Changes:

- pending 조건 apiYn=N 단일화, Sample master FK I/O·segId 검증
- 05/06 Sample 조회, 06 Sample 롤백+Master 삭제 cleanup
- 07 generateSegId 제거
Changed files: new_ver/test/*.js, docs/log/log.md

40. 2026-08-21 Sample XML dbindex 정리
Purpose: 주석 블록 대신 ACC 스키마에 조회용 dbindex를 선언한다.
Changes:

- idx_queue_pending (ingestYm, lineNo, apiYn) — Factory/워커 pending 스캔
- idx_membershipUid 유지
Changed files: new_ver/schema/testWooTargetSample.xml, docs/log/log.md

41. 2026-08-21 migration SQL ACC 방식으로 수정
Purpose: 인덱스는 구조 업데이트가 관리하므로 SQL DROP 제거, 백필만 유지.
Changes:

- 01_migration.sql: DROP INDEX 삭제, apiYn/imasterid 백필·검증만
- MIGRATION.md: partial index·수동 DROP 안내 제거
Changed files: new_ver/sql/01_migration.sql, new_ver/docs/MIGRATION.md, new_ver/js/testWooBulkApiWorker.js, new_ver/workflow/factory/02_Polling.js, docs/log/log.md

39. 2026-08-21 Detail 폐기 Sample FK 전송 최적화
Purpose: Detail WriteCollection 제거, Sample segId+master FK, 단일 라운드·NTILE 분할로 5천만 건 처리량 개선.
Changes:

- Sample segId/master link, partial index SQL, segId 테스트 시딩 SQL
- worker: sendSlice 50MB 분할, updateSampleSent, BATCH 150k, WORKER 3, STATUS_CPM
- Factory: ROUND_LIMIT=0, GRAND_TOTAL 50M, NTILE, pendingRows finish
- docs/MIGRATION.md 배포·롤백 가이드
Changed files: new_ver/schema/testWooTargetSample.xml, new_ver/schema/testWooTargetBulkApiMaster.xml, new_ver/sql/01_migration.sql, new_ver/sql/02_seed_segid.sql, new_ver/js/testWooBulkApiWorker.js, new_ver/js/testWooBulkApiStatus.js, new_ver/workflow/factory/*.js, new_ver/docs/MIGRATION.md, docs/log/log.md

38. 2026-08-21 Status WF Test/Wait 캔버스 가이드
Purpose: TBAWStatus 03_Test 전환 조건(working/finish)과 Wait 1m 연결을 statusLogic에 명시한다.
Changes:

- statusLogic 2.1: 캔버스 연결, Test 2전환, Factory 3전환 참고, next 분기 없음
- 00_Config 주석에 03_Test 조건식 추가
Changed files: new_ver/docs/statusLogic.md, new_ver/workflow/status/00_Config.js, docs/log/log.md

37. 2026-08-21 GitHub Develop 리모트 동기화
Purpose: 큐 키 전환·Factory/스모크 정리·batchStatus 분리 잡을 origin/main에 올린다.
Changes:

- ingestYm+lineNo 큐 스키마·백필 SQL, Factory/워커/스모크 계약 통일
- BULK_CFG 단일 소스, 배치 5만·planName, batchStatus 후속 WF(statusLogic)
Changed files: docs/log/log.md, new_ver/docs/newLogic.md, new_ver/docs/statusLogic.md, new_ver/docs/TestResult.md, new_ver/js/testWooBulkApiWorker.js, new_ver/js/testWooBulkApiStatus.js, new_ver/schema/*, new_ver/test/*.js, new_ver/workflow/**

36. 2026-08-21 batchStatus 재조회 잡을 분리
Purpose: 전송 중 GET을 없애고, 1~2시간 뒤 Master URL을 청크 GET 하는 별도 WF로 적재 상태를 채운다.
Changes:

- 전송 라이브러리에서 POLL_MAX·pollBatchStatus 삭제. Master는 URL만
- testWooBulkApiStatus.js + workflow/status 00/01/02. 공식 complete/incomplete/stuck
- 24시간 incomplete는 로컬 stuck. enum에 unknown 추가 안 함
Changed files: new_ver/js/testWooBulkApiWorker.js, new_ver/js/testWooBulkApiStatus.js, new_ver/workflow/status/00_Config.js, new_ver/workflow/status/01_StatusGet.js, new_ver/workflow/status/02_Decide.js, new_ver/docs/statusLogic.md, new_ver/docs/newLogic.md, new_ver/schema/testWooTargetBulkApiMaster.xml, docs/log/log.md

35. 2026-08-21 배치 5만·planName·POLL_MAX=0
Purpose: 전송 HTTP를 줄이고 planName을 같이 보낸다. complete GET은 후속 잡으로 분리한다.
Changes:

- BATCH_SIZE 20000→50000, CUSTOM_ATTR=@planName, POLL_MAX 1→0
- WORKER_COUNT는 5 유지. Factory는 TBAW1~5만 발사
Changed files: new_ver/js/testWooBulkApiWorker.js, docs/log/log.md

34. 2026-08-21 Factory-라이브러리 설정 중복 제거
Purpose: 스모크와 같이 Factory가 BULK_CFG 값을 다시 선언하거나 시그널로 덮지 않게 한다.
Changes:

- FACTORY_CFG에서 WORKER_COUNT·BATCH_SIZE 삭제. 00은 BULK_CFG만 읽음
- 01 PostEvent에서 batchSize·dryRun 제거. workerCount=fireN만 유지
- 라이브러리 주석: Factory는 오버라이드 없음. 스모크 실전송만 batchSize
Changed files: new_ver/workflow/factory/00_Config.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/worker/worker.js, new_ver/js/testWooBulkApiWorker.js, new_ver/docs/newLogic.md, docs/log/log.md

33. 2026-08-21 Factory를 큐 키 시그널로 업그레이드
Purpose: 스모크 LineNo Ver 2가 FAIL=0이므로 Factory/워커를 ingestYm+lineNo 계약으로 맞춘다. 예전 uidStart를 남기면 워커가 throw한다.
Changes:

- 00: pending에 lineNo>=1·ingestYm. WORKER_MAX는 BULK_CFG
- 01: 한 월 offset 분할, PostEvent ingestYm/lineStart/lineEnd. 토큰 미복사
- worker.js: 큐 키 로그, done|sent|failed. 02 폴링은 계약 유지
Changed files: new_ver/workflow/factory/00_Config.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js, new_ver/workflow/worker/worker.js, new_ver/docs/newLogic.md, docs/log/log.md

32. 2026-08-21 스모크 설정을 BULK_CFG 단일 소스로 정리
Purpose: BATCH_SIZE·WORKER_COUNT·스키마·토큰을 스모크가 다시 선언·오버라이드하지 않게 한다.
Changes:

- 01에서 SMOKE_BATCH/SMOKE_WORKERS/smkCustom 제거. 값은 BULK_CFG만
- 02 T4/T5/T6/T6b, 05/06 스키마명을 BULK_CFG에서 읽음
Changed files: new_ver/test/01_SmokeConfig.js, new_ver/test/02_SmokeLocal.js, new_ver/test/03_SmokeFire.js, new_ver/test/05_SmokeApiTest.js, new_ver/test/06_SmokeVerify.js, docs/log/log.md

31. 2026-08-20 스모크 5천만 count 제거·큐 백필 SQL
Purpose: 적재월/일련이 비어 있으면 워커가 대상을 못 잡고, 스모크 전표 count는 5천만에서 타임아웃 난다.
Changes:

- pending 조건에 lineNo>=1. T2는 1행 조회로 변경
- T3 Detail 큐 키를 000000/1 로 샘플과 분리
- backfillSampleQueue.sql 500만 건 단위 UPDATE
Changed files: new_ver/test/01_SmokeConfig.js, new_ver/test/02_SmokeLocal.js, new_ver/schema/backfillSampleQueue.sql, new_ver/docs/newLogic.md, docs/log/log.md

30. 2026-08-20 Sample 큐 컬럼 notNull 제거 (PGS-220000)
Purpose: 기존 행이 있는 Sample에 ingestYm NOT NULL을 붙이면 PostgreSQL이 거절한다. 컬럼은 nullable로 추가하고 백필한다.
Changes:

- ingestYm/lineNo notNull 삭제. Default 0 NOT NULL 은 queueLine 유니크와 충돌
Changed files: new_ver/schema/testWooTargetSample.xml, new_ver/docs/newLogic.md, docs/log/log.md

29. 2026-08-20 Sample·Detail에서 UID 유니크 제거
Purpose: 같은 UID가 날짜·세그마다 큐 행과 전송 로그로 남게 한다. UID 단독 업서트는 어제 이력을 덮어쓴다.
Changes:

- Sample: membershipUid UK 삭제, 비유니크 인덱스만
- Detail: ingestYm+lineNo UK, 라이브러리 _key를 큐 키로
Changed files: new_ver/schema/testWooTargetSample.xml, new_ver/schema/testWooTargetBulkApiDetail.xml, new_ver/js/testWooBulkApiWorker.js, new_ver/test/02_SmokeLocal.js, new_ver/docs/newLogic.md, docs/log/log.md

28. 2026-08-20 전송 큐 키 ingestYm+lineNo (Phase A)
Purpose: UID는 업무 키만 쓰고, 분할·조회·apiYn은 적재월+월내 일련으로 고정한다. 스키마·라이브러리·스모크만 반영하고 Factory는 다음 phase로 둔다.
Changes:

- Sample에 ingestYm/lineNo, queueLine UK, idx_mt_apiYn_queue
- BulkApiWorker 시그널 ingestYm+lineStart+lineEnd. LINE_NO_MAX=20억, wrap 금지
- 스모크 01~03/06/07을 큐 키 계약으로 맞춤. workflow 미변경
Changed files: new_ver/docs/newLogic.md, new_ver/schema/testWooTargetSample.xml, new_ver/js/testWooBulkApiWorker.js, new_ver/test/01_SmokeConfig.js, new_ver/test/02_SmokeLocal.js, new_ver/test/03_SmokeFire.js, new_ver/test/06_SmokeVerify.js, new_ver/test/07_SmokeSignalWorker.js, docs/log/log.md

27. 2026-08-20 GitHub Develop 리모트 동기화
Purpose: Factory 운영 스위치 정리와 UID 오름차순 offset 분할을 origin/main에 올린다.
Changes:

- ENABLED/DRY_RUN 제거, dryRun은 스모크 전용
- arith/prefix 분할 제거, pending membershipUid 오름차순 앞 500만 건
Changed files: docs/log/log.md, new_ver/docs/newLogic.md, new_ver/js/testWooBulkApiWorker.js, new_ver/workflow/factory/00_Config.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js

26. 2026-08-20 Factory 분할을 UID 오름차순 offset 으로 변경
Purpose: PRD 고객번호는 U+자릿수가 아니므로 arith/prefix 를 제거하고, pending 을 membershipUid 순으로 앞 500만 건만 보낸다.
Changes:

- 00: UID_PREFIX/DIGITS/PARTITION 삭제. ROUND_LIMIT=GRAND_TOTAL=5000000. MAX_RUN=360
- 01: offset 경계만. UID-1 산술 없음. 라이브러리 조회 주석에 오름차순 명시
Changed files: new_ver/workflow/factory/00_Config.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js, new_ver/js/testWooBulkApiWorker.js, new_ver/docs/newLogic.md, docs/log/log.md

25. 2026-08-20 Factory에서 ENABLED·DRY_RUN 제거
Purpose: 정지는 캔버스, dryRun은 스모크가 담당하므로 운영 Factory 설정에서 중복 스위치를 뺀다. GRAND_TOTAL 주석을 누적 sent로 바로잡는다.
Changes:

- 00에서 ENABLED/DRY_RUN 삭제. 01 PostEvent dryRun은 항상 false
- GRAND_TOTAL 주석: 한 방 UID 구간이 아님, pending min부터, 9자리 패딩
Changed files: new_ver/workflow/factory/00_Config.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/docs/newLogic.md, docs/log/log.md

24. 2026-08-20 GitHub Develop 리모트 동기화
Purpose: 최초 푸시 이후 스모크·Factory·가드레일 변경을 origin/main에 올린다.
Changes:

- 스모크 01~07을 라이브러리 계약으로 재작성. T3 링크·실전송·Verify 경로 수정
- Factory 운영 구현, 동시 워커 스로틀, WORKER_MAX=15, urlPermission/인증 가이드
Changed files: docs/log/log.md, docs/main/01_ProfileApiDataIntegration.md, new_ver/docs/newLogic.md, new_ver/js/testWooBulkApiWorker.js, new_ver/test/*.js, new_ver/workflow/**

23. 2026-08-20 워커 상한을 15로 변경
Purpose: 동시 워커 클램프를 14(15 미만)에서 15로 올려 TBAW15까지 운영할 수 있게 한다.
Changes:

- FACTORY_CFG.WORKER_MAX 와 BULK_CFG.WORKER_MAX 를 15. 폴백도 15
- 스로틀 주석 15개 ≈25.7초. worker.js / newLogic 상한 문구 맞춤
Changed files: new_ver/workflow/factory/00_Config.js, new_ver/js/testWooBulkApiWorker.js, new_ver/workflow/worker/worker.js, new_ver/docs/newLogic.md, docs/log/log.md

22. 2026-08-20 Factory/Worker 주석·가드레일 보강
Purpose: 00_Config 변수 용도와 가드레일을 스모크 01_Config 수준으로 명시하고, workflow 전 파일에 기능별 주석을 넣는다.
Changes:

- 00: F1~F7 그룹. 워커 수·50콜/분·물량 상한·UID 형식·Option STRICT 를 변수마다 표시
- 01/02/worker: SQL 폴백, arith 닫힌 구간, state=11, fireN 스로틀, Option 파싱, 전 건 실패→error
Changed files: new_ver/workflow/factory/00_Config.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js, new_ver/workflow/worker/worker.js, docs/log/log.md

21. 2026-08-20 Factory 운영 구현과 동시 워커 스로틀
Purpose: 5차 스모크 FAIL=0 이후 Factory를 스모크 시그널 계약으로 재작성하고, 워커 5~14 동시 기동 시 Target 50콜/분 폭주를 막는다.
Changes:

- 00/01/02: FACTORY_CFG만 설정. PostEvent에 dryRun/workerCount/customAttr. 폴링은 sent 합
- 라이브러리: WORKER_MAX=14, 첫 POST는 STAGGER_SLOT_MS×(n-1). worker.js는 done|sent|failed
Changed files: new_ver/workflow/factory/00_Config.js, new_ver/workflow/factory/01_WorkerDistributor.js, new_ver/workflow/factory/02_Polling.js, new_ver/workflow/worker/worker.js, new_ver/js/testWooBulkApiWorker.js, new_ver/docs/newLogic.md, docs/log/log.md

20. 2026-08-20 T3 링크를 [@master-id]와 [master/@id] 둘 다 확인
Purpose: configure list에서 FK(@master-id)와 조인 PK(master/@id)가 같은 값임이 확인됐다. T3가 둘을 같이 읽고 일치하는지 본다.
Changes:

- select에 [@master-id] alias=@masterFk, [master/@id] alias=@masterPk, [master/@batchName] 유지
- 링크 PASS 조건: 어느 한쪽이 masterId이거나 batchName 일치, 그리고 두 id가 동시에 있으면 서로 같음
Changed files: new_ver/test/02_SmokeLocal.js, docs/log/log.md

19. 2026-08-20 T3 링크 조회를 [@master-id]로 교정
Purpose: 콘솔 Detail 스키마 FK xpath가 [@master-id] 임을 확인했고, T3가 [master/@id] 조인으로 읽고 있었다.
Changes:

- queryDef select를 [@master-id] alias=@masterFk 로 변경. E4X는 d.@master-id 를 빼기로 파싱하므로 alias 필수
- SQL imasterid 폴백 제거. 조인 batchName 은 보조
Changed files: new_ver/test/02_SmokeLocal.js, docs/log/log.md

18. 2026-08-20 T3 Detail→Master 링크 판정을 SQL로 교정
Purpose: 4차 스모크에서 Bulk/Fetch는 성공인데 T3가 조인 XML을 E4X로 잘못 읽어 FAIL=1이 되고 Verify가 Factory 제작 금지를 던졌다.
Changes:

- Detail 쓰기를 라이브러리와 같이 collection 루트로 맞춤. SMK0000001 잔여 행 삭제 후 삽입
- 링크 확인은 imasterid SQL과 [master/@id] alias. 실패 시에만 XML 덤프
Changed files: new_ver/test/02_SmokeLocal.js, docs/log/log.md

17. 2026-08-20 urlPermission 차단 시 done 오보고 수정
Purpose: Campaign이 tt.omtrdc.net 을 막으면 POST가 실패하는데 워커가 done을 남겨 Fetch 404와 혼동된다.
Changes:

- JST-310026 등 message 없는 예외는 errText로 기록. 전 건 실패 시 throw → error
- 가이드에 serverConf.xml urlPermission 허용과 nlserver 재시작을 명시
Changed files: new_ver/js/testWooBulkApiWorker.js, new_ver/test/07_SmokeSignalWorker.js, new_ver/workflow/worker/worker.js, docs/main/01_ProfileApiDataIntegration.md, docs/log/log.md

16. 2026-08-19 2차 스모크 T3 링크·Test 분기 수정
Purpose: Detail 링크 판정이 빈 @batchName을 봐 FAIL=1이 되고, Test가 05/06으로 안 가는 경로를 막는다.
Changes:

- T3 링크는 master-id / master.batchName / alias 로 판정
- 04는 smkNext와 nextAction을 같이 세팅. 워커 로그는 TBAWSmokeSignal 저널
Changed files: new_ver/test/02_SmokeLocal.js, new_ver/test/04_SmokePolling.js, docs/log/log.md

15. 2026-08-19 1차 스모크 로그 원인 수정
Purpose: runId 미배포로 T3가 통째로 실패하고, max UID 공백·state 20 오판으로 Fire/Poll이 멈춘 경로를 고친다.
Changes:

- T3는 runId 없이 I/O. 회차 식별은 batchName. runId 미배포는 WARN
- T4 min/max는 SQL. span<=0이면 밀도 Infinity 판정 안 함
- 시그널 WF 시작됨=11, 20은 stop(공식). 미시작은 skip이지 error가 아님
- 05/06 @runId 조건 제거
Changed files: new_ver/test/02_SmokeLocal.js, new_ver/test/03_SmokeFire.js, new_ver/test/05_SmokeApiTest.js, new_ver/test/06_SmokeVerify.js, docs/log/log.md

14. 2026-08-19 기본 스모크에 샘플 UID 소수 실전송
Purpose: 샌드박스 Target에 pending 2건을 라이브러리 경로로 올리고, 기존 캔버스에서 batchStatus·Fetch·apiYn을 확인한다.
Changes:

- 03 Fire: dryRun=false, pending SMOKE_REAL_ROWS(2)건만 PostEvent
- 05는 가짜 A/B 대신 실전송 Master URL + Profile Fetch. 404는 적재 지연으로 통과
- 06은 apiYn=Y 확인 후 로그만 삭제. Target·Sample 플래그는 유지
Changed files: new_ver/test/01_SmokeConfig.js, new_ver/test/03_SmokeFire.js, new_ver/test/05_SmokeApiTest.js, new_ver/test/06_SmokeVerify.js, new_ver/docs/newLogic.md, docs/log/log.md

13. 2026-08-19 스모크를 라이브러리 계약으로 재작성
Purpose: Factory보다 스모크를 먼저 맞춰, 통과한 워커 진입 계약으로 이후 Factory를 짠다.
Changes:

- test 01~07: 설정은 BULK_CFG. 같은 캔버스 dryRun. PostEvent에 dryRun/workerCount/customAttr
- 폴링·워커 보고는 {runId}|status. 실호출 기본 OFF. runId 컬럼·흔적 정리
- workflow/worker/worker.js 를 07과 동일 계약으로 맞춤. Factory 00/01/02는 미변경
Changed files: new_ver/test/01_SmokeConfig.js, new_ver/test/02_SmokeLocal.js, new_ver/test/03_SmokeFire.js, new_ver/test/04_SmokePolling.js, new_ver/test/05_SmokeApiTest.js, new_ver/test/06_SmokeVerify.js, new_ver/test/07_SmokeSignalWorker.js, new_ver/workflow/worker/worker.js, new_ver/docs/newLogic.md, docs/log/log.md

12. 2026-08-19 AUTH_TOKEN을 Profile API UI 경로로 명시
Purpose: 공식 Profile API settings와 Debugger tools 문서로 토큰이 다름을 확인하고, Administration > Implementation에서 찾을 수 있게 주석·가이드를 맞춘다.
Changes:

- AUTH_TOKEN 주석: Profile API Require Authentication + Generate New Profile Authentication Token. Debugger tools 토큰 제외
- 01 가이드 5절에 같은 화면의 세 구역(Account Details / Profile API / Debugger) 표
Changed files: new_ver/js/testWooBulkApiWorker.js, docs/main/01_ProfileApiDataIntegration.md, new_ver/docs/newLogic.md, docs/log/log.md

11. 2026-08-19 라이브러리 xtk:option 조회 제거
Purpose: 설정은 BULK_CFG와 시그널만 쓰고, AUTH_OPTION / CUSTOM_ATTR_OPTION getOption 경로를 없앤다.
Changes:

- AUTH_OPTION, CUSTOM_ATTR_OPTION 및 getOption 호출 삭제. 토큰·CUSTOM_ATTR은 시그널 > BULK_CFG
- newLogic 라이브러리 계약을 같은 우선순위로 맞춤. Factory 워커 상태 Option은 프로토타입 그대로
Changed files: new_ver/js/testWooBulkApiWorker.js, new_ver/docs/newLogic.md, docs/log/log.md

10. 2026-08-19 GitHub Develop 리모트 최초 푸시
Purpose: 홈 디렉터리 Git과 분리해 프로젝트 전용 저장소를 만들고, 현재 전체 소스를 Develop 리모트에 올린다.
Changes:

- 프로젝트 루트에 git init (main), origin을 Campaign_Target_Bulk_API_Develop.git으로 설정
- docs/old_ver/new_ver 전체 커밋 후 origin/main 푸시
Changed files: docs/log/log.md, .git/

9. 2026-08-19 Profile API 가이드에 가드레일 명시
Purpose: 256자는 행 합이 아니라 속성값 1개, 64KB는 방문자 프로필 전체임을 Campaign→Target Bulk 기준으로 적는다.
Changes:

- 3.5를 가드레일 절로 재작성. 칸당 256 / UID 256 / 이름 128 / 프로필 64KB / 파일 50MB·50만행 / 분당 50콜
- Bulk에 값당 256 명시는 없고 Delivery/mbox hard limit인 점, 침묵 절단 금지, encode 후 50MB
- 체크리스트·장애 표·추출 확인 항목 동기화. 다른 시스템 파이프는 추가하지 않음
Changed files: docs/main/01_ProfileApiDataIntegration.md, docs/log/log.md

8. 2026-08-19 CUSTOM_ATTR 가변 프로필 컬럼
Purpose: 기본 uid+seg_id 외에 샘플 스키마 속성을 Target profile.*로 같이 보내 일배치 속성 갱신·오디언스 선정에 쓴다.
Changes:

- CUSTOM_ATTR / CUSTOM_ATTR_OPTION / 시그널 customAttr 파싱 (쉼표·배열, @ 제거, 예약 컬럼 제외)
- queryMembers select·CSV 헤더/행에 동적 컬럼. 빈 값은 기존 프로필 유지. Detail에는 미저장
- DRY_RUN은 CSV 헤더만 로그. newLogic 6.7 계약 추가
Changed files: new_ver/js/testWooBulkApiWorker.js, new_ver/docs/newLogic.md, docs/log/log.md

7. 2026-08-19 BulkApiWorker 재검수 — enum/HTTP/컬럼길이 가드
Purpose: 한 줄 재검수 후 제출 성공이 Master Write 실패로 뒤집히는 경로를 막는다.
Changes:

- batchStatus는 complete/incomplete/stuck만 기록
- batchStatus GET 비2xx는 checked로 보지 않음
- batchName/workerName/runId 컬럼 길이 절단, perWorkerCpm<=0 가드
Changed files: new_ver/js/testWooBulkApiWorker.js, docs/log/log.md

6. 2026-08-19 BulkApiWorker 검수 항목 반영 (인증·escape·batchStatus)
Purpose: 기준 라이브러리에 검수에서 필요했던 보완을 ACC JS로 넣는다. 적재 완료 대기는 하지 않고 짧은 batchStatus GET만 수행한다.
Changes:

- Bearer 토큰(시그널/CFG/Option), sqlLit, apiYn N/NULL 조회, clipSegId, UID URL-encode
- pollBatchStatus 후 Master 적재 컬럼 기록, runId 저장, workerCount 1 미만 가드
- Master 스키마에 runId + idx_runId, newLogic 계약 동기화
Changed files: new_ver/js/testWooBulkApiWorker.js, new_ver/schema/testWooTargetBulkApiMaster.xml, new_ver/docs/newLogic.md, docs/log/log.md

5. 2026-08-19 new_ver Logic 정리 및 라이브러리·스키마 검수
Purpose: new_ver 큰 흐름을 newLogic.md에 모으고, 기준 라이브러리·로그 스키마를 ACC/공식 API 기준으로 검수한다. Factory/Worker/Smoke는 프로토타입으로 명시한다.
Changes:

- new_ver/docs/newLogic.md 작성 (흐름, old 대비 개선, 검수, 스키마 유지/예약/중복)
- Master 스키마에서 attemptCount/elapsedMs 중복 선언 제거
- 라이브러리 코드는 미수정. 인증·batchStatus 폴링·UID escape는 다음 Phase 후보
Changed files: new_ver/docs/newLogic.md, new_ver/schema/testWooTargetBulkApiMaster.xml, docs/log/log.md

4. 2026-08-19 Profile API 연동 가이드에 조회 API 섹션 추가
Purpose: 공식 Profile Fetch와 batchStatus를 정리하고, 배치 전체 행 조회 API가 없음을 명시한다.
Changes:

- 4절: 배치 상태 GET, 단건 Fetch(thirdPartyId/tntid/ECID), 전수는 로컬 로그 + 반복 Fetch
- 체크리스트·장애 표에 Fetch 404, batchId 보관 항목 추가
Changed files: docs/main/01_ProfileApiDataIntegration.md, docs/log/log.md

3. 2026-08-19 문서 흐름도를 mermaid에서 ASCII로 전환
Purpose: 모든 md 문서의 mermaid 다이어그램을 렌더러 없이 읽히는 ASCII 흐름도로 교체한다.
Changes:

- old_ver/docs/logic.md: Factory/Distributor/상태/Worker/배치/ER/시퀀스 7곳
- docs/main/01_ProfileApiDataIntegration.md: 전송수단/재구성순서/논리골격 3곳
Changed files: old_ver/docs/logic.md, docs/main/01_ProfileApiDataIntegration.md, docs/log/log.md

2. 2026-08-19 old_ver Logic에 스키마 명세와 로그 보완 속성 추가
Purpose: old_ver/schema XML을 Logic에 반영한다. 고객 스키마는 테스트 샘플로 명시하고, Master/Detail 로그는 현행 속성과 신버전 보완 후보를 같이 적는다.
Changes:

- 구성 요소에 schema 3파일 추가
- lgu_member / master / detail 속성·enum·index·코드 기록 여부 정리
- 신버전 로그에 두면 좋은 속성(batchId, ingestStatus, 이력 unique 등)과 넣지 않을 고객 원천 컬럼을 구분
Changed files: old_ver/docs/logic.md, docs/log/log.md

1. 2026-08-19 old_ver Logic 보강 및 Profile API 연동 설명서 작성
Purpose: old_ver 코드를 분석해 Logic 문서를 흐름·상태 계약 중심으로 재작성하고, 공식 Bulk API 기준으로 재구성 체크리스트 설명서를 docs/main에 추가한다.
Changes:

- old_ver/docs/logic.md: Factory/Worker/BulkApiWorker 흐름도, 변수·Option 계약, Test 분기 공백, 전송·저장 순서를 코드와 맞춰 정리
- docs/main/01_ProfileApiDataIntegration.md: Target Profile 전송 수단 선택, Bulk v2 공식 계약, 재구성 시 확인·세팅 항목을 플랫폼 독립적으로 작성
Changed files: old_ver/docs/logic.md, docs/main/01_ProfileApiDataIntegration.md, docs/log/log.md
