-- 02_seed_segid.sql
-- Sample segId 사전 적재 (테스트/개발 시딩 전용)
-- Campaign SQL 활동 또는 psql. 한 문장씩 실행. 500만 건 단위.
-- lineNo % 100 → 조합 테이블 매핑. 같은 lineNo면 항상 동일 세그 조합(결정론). 운영 규칙 확정 시 교체.
-- ACC SQL 활동은 :start 같은 바인드 변수 미지원 → backfillSampleQueue.sql 과 동일하게 리터럴 구간 사용.

-- 0) 현재 상태
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (
    WHERE ssegid IS NULL OR btrim(ssegid) = ''
  ) AS need_seg,
  -- ilineno IS NULL 이면 (NULL % 100) 으로 시딩 누락. backfill 선행 여부 확인용
  COUNT(*) FILTER (WHERE ilineno IS NULL) AS need_backfill
FROM wootartestwootargetsample;

-- lineNo % 100 조합 매핑. CROSS JOIN + row_number (ACC SQL 은 LATERAL 미지원)
-- 100 × 50 카테시안에서 idx당 20개 태그 선택. 같은 lineNo → 같은 조합(결정론)
DROP TABLE IF EXISTS tmp_seg_combo;
CREATE TEMP TABLE tmp_seg_combo AS
SELECT idx, string_agg(tag, '|') AS segs
FROM (
  SELECT c.idx,
         'w' || LPAD(g::text, 2, '0') AS tag,
         row_number() OVER (
           PARTITION BY c.idx ORDER BY md5(g::text || c.idx::text)
         ) AS rn
  FROM generate_series(0, 99) c(idx)
  CROSS JOIN generate_series(1, 50) g
) s
WHERE rn <= 20
GROUP BY idx;

CREATE UNIQUE INDEX ON tmp_seg_combo (idx);

-- 조합 확인. 100행, 세그 길이 79 고정(w01|...|w20)
SELECT COUNT(*) AS combo_cnt, MIN(length(segs)) AS min_len, MAX(length(segs)) AS max_len
FROM tmp_seg_combo;

-- 1) 500만 건씩 UPDATE. membershipUid 10자 패딩 전제 (backfillSampleQueue.sql 과 동일 구간)
-- 구간 1/10
UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U000000001' AND s.smembershipuid <= 'U005000000';

UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U005000001' AND s.smembershipuid <= 'U010000000';

UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U010000001' AND s.smembershipuid <= 'U015000000';

UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U015000001' AND s.smembershipuid <= 'U020000000';

UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U020000001' AND s.smembershipuid <= 'U025000000';

UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U025000001' AND s.smembershipuid <= 'U030000000';

UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U030000001' AND s.smembershipuid <= 'U035000000';

UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U035000001' AND s.smembershipuid <= 'U040000000';

UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U040000001' AND s.smembershipuid <= 'U045000000';

UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U045000001' AND s.smembershipuid <= 'U050000000';

-- 2) 잔여(범위 밖 UID 등)
UPDATE wootartestwootargetsample s
SET ssegid = c.segs
FROM tmp_seg_combo c
WHERE c.idx = (s.ilineno % 100)
  AND (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid LIKE 'U%'
  AND s.ilineno >= 1;

-- 3) 확인. need_seg = 0
SELECT
  COUNT(*) FILTER (
    WHERE ssegid IS NULL OR btrim(ssegid) = ''
  ) AS need_seg,
  MIN(length(ssegid)) AS min_len,
  MAX(length(ssegid)) AS max_len
FROM wootartestwootargetsample;

-- 4) 전체 시딩 완료 후 1회 (선택)
-- VACUUM ANALYZE wootartestwootargetsample;

-- 주의: TEMP 테이블은 세션 종료 시 소멸.
--       ACC SQL 활동은 활동마다 세션이 다를 수 있음
--       → tmp_seg_combo 생성과 UPDATE 를 같은 활동/같은 psql 세션에서 실행할 것
--       세션 분리가 불가피하면 TEMP 대신 일반 테이블로 만들고 완료 후 DROP
