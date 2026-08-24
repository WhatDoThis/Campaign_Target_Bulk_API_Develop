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
  ) AS need_seg
FROM wootartestwootargetsample;

-- (변경) 행별 md5 50회 → 조합 100개 사전 생성 + 모듈로 매핑
-- 결정론 유지: 같은 lineNo 는 항상 같은 조합
DROP TABLE IF EXISTS tmp_seg_combo;
CREATE TEMP TABLE tmp_seg_combo AS
SELECT
  c.idx,
  (SELECT string_agg(t.tag, '|')
   FROM (
     SELECT 'w' || LPAD(g::text, 2, '0') AS tag
     FROM generate_series(1, 50) g
     ORDER BY md5(g::text || c.idx::text)
     LIMIT 20
   ) t) AS segs
FROM generate_series(0, 99) c(idx);

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
