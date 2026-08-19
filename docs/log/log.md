# Log

## Log Index

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
