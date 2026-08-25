-- wootar Sample 구조 업데이트(A1) 후 기존 행 백필
-- 인덱스는 testWooTargetSample.xml → 구조 업데이트 마법사가 생성·삭제함
--
-- [레거시] ingestYm(singestym) 기준 partial index.
-- ingestYmd 전환 후 sql/03_migrate_ingestYmd.sql §4 로 singestymd 인덱스 재생성.

UPDATE WootarTestWooTargetSample SET sapiyn = 'N' WHERE sapiyn IS NULL OR sapiyn = '';
UPDATE WootarTestWooTargetSample SET imasterid = 0 WHERE imasterid IS NULL;

SELECT COUNT(*) AS invalid_apiyn
  FROM WootarTestWooTargetSample
 WHERE sapiyn IS NULL OR sapiyn NOT IN ('Y', 'N');

-- (변경) 선택 → 필수. FIX-21 COUNT(*) 및 MIN/MAX 조회 성능 보장
-- 전송 완료분이 인덱스에서 자동 제외 → 라운드가 진행될수록 조회가 빨라짐
-- ACC 구조 업데이트 마법사는 미인지 인덱스를 삭제하지 않으므로 XML dbindex 와 공존
-- CONCURRENTLY 는 트랜잭션 블록 내 실행 불가 → psql 단독 실행 (ACC SQL 활동 금지)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sample_pending_partial
  ON wootartestwootargetsample (singestym, ilineno)
  WHERE sapiyn = 'N';

ANALYZE wootartestwootargetsample;
