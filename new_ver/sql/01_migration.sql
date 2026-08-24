-- wootar Sample 구조 업데이트(A1) 후 기존 행 백필
-- 인덱스는 testWooTargetSample.xml → 구조 업데이트 마법사가 생성·삭제함

UPDATE WootarTestWooTargetSample SET sapiyn = 'N' WHERE sapiyn IS NULL OR sapiyn = '';
UPDATE WootarTestWooTargetSample SET imasterid = 0 WHERE imasterid IS NULL;

SELECT COUNT(*) AS invalid_apiyn
  FROM WootarTestWooTargetSample
 WHERE sapiyn IS NULL OR sapiyn NOT IN ('Y', 'N');

-- (변경) 선택 적용. 전송 완료분이 인덱스에서 자동 제외되어 pending 조회가 갈수록 빨라짐
-- ACC 구조 업데이트 마법사는 미인지 인덱스를 삭제하지 않으므로 공존 가능
-- 단 XML dbindex 와 역할 중복 → 실측 후 하나만 유지 권장
-- CREATE INDEX CONCURRENTLY idx_sample_pending_partial
--   ON wootartestwootargetsample (singestym, ilineno)
--   WHERE sapiyn = 'N';
