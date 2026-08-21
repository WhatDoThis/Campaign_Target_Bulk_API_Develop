# Log

## Log Index

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
