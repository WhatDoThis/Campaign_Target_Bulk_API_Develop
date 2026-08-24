-- wootar Sample 구조 업데이트(A1) 후 기존 행 백필
-- 인덱스는 testWooTargetSample.xml → 구조 업데이트 마법사가 생성·삭제함

UPDATE WootarTestWooTargetSample SET sapiyn = 'N' WHERE sapiyn IS NULL OR sapiyn = '';
UPDATE WootarTestWooTargetSample SET imasterid = 0 WHERE imasterid IS NULL;

SELECT COUNT(*) AS invalid_apiyn
  FROM WootarTestWooTargetSample
 WHERE sapiyn IS NULL OR sapiyn NOT IN ('Y', 'N');
