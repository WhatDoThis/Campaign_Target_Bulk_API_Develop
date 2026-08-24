-- 02_seed_segid.sql
-- Sample segId 사전 적재 (테스트/개발 시딩 전용)
-- Campaign SQL 활동 또는 psql. 한 문장씩 실행. 500만 건 단위.
-- md5(g || lineNo) → 같은 lineNo면 항상 동일 세그 조합(결정론). 운영 규칙 확정 시 교체.
-- ACC SQL 활동은 :start 같은 바인드 변수 미지원 → backfillSampleQueue.sql 과 동일하게 리터럴 구간 사용.

-- 0) 현재 상태
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (
    WHERE ssegid IS NULL OR btrim(ssegid) = ''
  ) AS need_seg
FROM wootartestwootargetsample;

-- 1) 500만 건씩 UPDATE. membershipUid 10자 패딩 전제 (backfillSampleQueue.sql 과 동일 구간)
UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U000000001' AND s.smembershipuid <= 'U005000000';

UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U005000001' AND s.smembershipuid <= 'U010000000';

UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U010000001' AND s.smembershipuid <= 'U015000000';

UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U015000001' AND s.smembershipuid <= 'U020000000';

UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U020000001' AND s.smembershipuid <= 'U025000000';

UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U025000001' AND s.smembershipuid <= 'U030000000';

UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U030000001' AND s.smembershipuid <= 'U035000000';

UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U035000001' AND s.smembershipuid <= 'U040000000';

UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U040000001' AND s.smembershipuid <= 'U045000000';

UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
  AND s.smembershipuid >= 'U045000001' AND s.smembershipuid <= 'U050000000';

-- 2) 잔여(범위 밖 UID 등)
UPDATE wootartestwootargetsample s
SET ssegid = (
  SELECT string_agg(t.tag, '|')
  FROM (
    SELECT 'w' || LPAD(g::text, 2, '0') AS tag
    FROM generate_series(1, 50) g
    ORDER BY md5(g::text || s.ilineno::text)
    LIMIT 20
  ) t
)
WHERE (s.ssegid IS NULL OR btrim(s.ssegid) = '')
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
