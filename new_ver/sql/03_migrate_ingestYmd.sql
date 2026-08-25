-- 03_migrate_ingestYmd.sql
-- =============================================================================
-- [이 파일이 하는 일] — 스키마 XML / dbindex 와 **다른 것**
-- =============================================================================
-- ① XML <dbindex> (idx_pending_queue, idx_lineNo, idx_ingestYmd …)
--    → testWooTargetSample.xml 에 정의 → ACC 「구조 업데이트」 마법사가 PG 인덱스 생성
--    → 검색·queryDef·UK 와 함께 ACC가 관리하는 일반 인덱스
--
-- ② 본 파일 §4 idx_sample_pending_partial
--    → XML 에 넣을 수 없는 **부분 인덱스** (WHERE sapiyn='N')
--    → splitBounds MIN/MAX/COUNT 대량 성능용 (FIX-23). psql CONCURRENTLY 로만 생성
--    → ACC 마법사는 미인지 인덱스를 삭제하지 않으므로 XML dbindex 와 **공존**
--
-- ③ §1~§3, §5
--    → ingestYm(singestym) → ingestYmd(singestymd) **컬럼 전환** 백업·백필·검증 SQL
--    → 구조 업데이트 전후 1회성 마이그레이션용 (인덱스 정의 파일 아님)
-- =============================================================================
--
-- Sample 큐 키 ingestYm(YYYYMM) → ingestYmd(YYYYMMDD) 전환
-- schema/testWooTargetSample.xml 구조 업데이트 전·후에 psql 또는 Campaign SQL 활동으로 실행--
-- =============================================================================
-- [ACC 공식] 스키마 컬럼 수정·삭제 절차 (Campaign Classic v7)
-- =============================================================================
-- 1) 커스텀 srcSchema(wootar:testWooTargetSample) XML 수정 후 저장·게시
--    - 속성 추가/길이 변경: <attribute name="ingestYmd" length="8" .../>
--    - 속성 삭제: <attribute _operation="delete" name="ingestYm"/>
--    - 참고: https://experienceleague.adobe.com/en/docs/campaign-classic/using/configuring-campaign-classic/editing-schemas/about-schema-edition
-- 2) Administration > Configuration > Data schemas 에서 스키마 선택
--    → Actions > Update database structure (구조 업데이트 마법사)
--    - 논리(XML)와 물리(PG) diff 확인 후 SQL 실행
--    - 참고: https://experienceleague.adobe.com/en/docs/campaign-classic/using/configuring-campaign-classic/editing-schemas/updating-the-database-structure
-- 3) 컬럼 rename 은 마법사가 DROP+ADD 로 생성할 수 있음 → §1 백업·§3 백필 선행
-- 4) queueLine UK·idx_pending_queue 변경 시 5천만 행 테이블 인덱스 재생성 — 수 분~수십 분
--
-- ingestYmd 데이터 포맷 가이드
--   형식: YYYYMMDD (8자리 숫자 문자열)
--   예: 20260824 = 2026년 8월 24일
--   ACC formatDate: formatDate(new Date(), "%4Y%2M%2D")  ← 월·일 구분자 없음
--   Factory BIZ_DATE(추가 예정)와 동일 포맷으로 비교
--   잘못된 예: 202608(6자), 2026-08-24(하이픈), 202608-24
--
-- =============================================================================
-- 권장 실행 순서 (기존 singestym 데이터 보존)
-- =============================================================================
-- A. §1 백업 (구조 업데이트 직전, singestym 아직 있을 때)
-- B. schema/testWooTargetSample.xml 게시 → 구조 업데이트 (singestymd 추가·singestym 삭제·UK 교체)
-- C. §3 백필 (singestymd 비어 있을 때 — §1 백업 또는 YM→YMD 변환)
-- D. §4 partial index 재생성 (singestym → singestymd)
-- E. §5 확인 SELECT
-- F. backfillSampleQueue.sql 은 신규 적재·초기화 시 ingestYmd 기준으로 사용
--
-- =============================================================================

-- §1) 구조 업데이트 **전** 백업 (singestym 컬럼이 있을 때만)
-- DROP TABLE IF EXISTS wootartestwootargetsample_ym_backup;
-- CREATE TABLE wootartestwootargetsample_ym_backup AS
-- SELECT iid, singestym, ilineno, smembershipuid
-- FROM wootartestwootargetsample;

-- §2) 구조 업데이트 **후** singestymd 컬럼 존재 확인
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'wootartestwootargetsample'
--   AND column_name IN ('singestym', 'singestymd');

-- §3) ingestYmd 백필
-- 아래 @TARGET_YMD@ 를 운영 기준일로 교체 (예: 20260824)
-- 경로 A — §1 백업 테이블이 있을 때 (YYYYMM + 일 2자리)
-- UPDATE wootartestwootargetsample t
-- SET singestymd = b.singestym || '24'
-- FROM wootartestwootargetsample_ym_backup b
-- WHERE t.iid = b.iid
--   AND (t.singestymd IS NULL OR btrim(t.singestymd) = '');

-- 경로 B — 백업 없이 전 행 동일 적재일 부여 (프로토타입 일괄 전환)
-- UPDATE wootartestwootargetsample
-- SET singestymd = '20260824'
-- WHERE singestymd IS NULL OR btrim(singestymd) = '';

-- 경로 C — lineNo·UID 백필과 함께 (backfillSampleQueue.sql §2와 동일 패턴, singestymd 사용)

-- §4) partial index — singestymd 기준으로 재생성 (psql 단독, ACC SQL 활동 금지)
DROP INDEX CONCURRENTLY IF EXISTS idx_sample_pending_partial;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sample_pending_partial
  ON wootartestwootargetsample (singestymd, ilineno)
  WHERE sapiyn = 'N';

ANALYZE wootartestwootargetsample;

-- §5) 확인 — need_fill=0, ingestYmd 8자리
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (
    WHERE ilineno IS NULL OR ilineno < 1
       OR singestymd IS NULL OR btrim(singestymd) = ''
       OR length(btrim(singestymd)) <> 8
  ) AS need_fill,
  MIN(singestymd) AS min_ymd,
  MAX(singestymd) AS max_ymd,
  MIN(ilineno) AS min_line,
  MAX(ilineno) AS max_line
FROM wootartestwootargetsample;

-- pending 분포 (Factory BIZ_DATE 선행 확인용)
SELECT singestymd, COUNT(*) AS pending_cnt
FROM wootartestwootargetsample
WHERE sapiyn = 'N'
GROUP BY singestymd
ORDER BY singestymd;

-- EXPLAIN — idx_pending_queue / partial index 사용 확인
-- EXPLAIN SELECT ilineno FROM wootartestwootargetsample
-- WHERE sapiyn='N' AND singestymd='20260824' ORDER BY ilineno LIMIT 10;
