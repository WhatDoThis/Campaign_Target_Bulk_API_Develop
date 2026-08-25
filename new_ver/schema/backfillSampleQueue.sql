-- backfillSampleQueue.sql
-- Sample 행에 ingestYmd + lineNo 부여 (PostgreSQL)
-- Campaign SQL 활동 또는 psql. 한 문장씩 실행. 5백만 건 단위.
-- UID 형식: U + 9자리 (U000000001). lineNo = UID 숫자.
-- ingestYmd 포맷: YYYYMMDD 8자리 (예: 20260824). Factory BIZ_DATE 와 동일 규칙.
-- 스모크/라이브러리 배포 전에 이 스크립트가 끝나 있어야 한다.

-- 0) 현재 상태
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (
    WHERE ilineno IS NULL OR ilineno = 0
       OR singestymd IS NULL OR btrim(singestymd) = ''
       OR length(btrim(singestymd)) <> 8
  ) AS need_fill
FROM wootartestwootargetsample;

-- 1) UID 숫자 중복이면 여기서 멈춘다. 0행이어야 함.
SELECT CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER) AS n, COUNT(*) AS c
FROM wootartestwootargetsample
WHERE smembershipuid LIKE 'U%'
GROUP BY 1
HAVING COUNT(*) > 1;

-- @INGEST_YMD@ — 적재월일. 운영 기준일로 교체 (예: 20260824)
-- 2) 500만 건씩 UPDATE. 문자열 비교는 10자 패딩 UID 전제.
UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid >= 'U000000001' AND smembershipuid <= 'U005000000';

UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid >= 'U005000001' AND smembershipuid <= 'U010000000';

UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid >= 'U010000001' AND smembershipuid <= 'U015000000';

UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid >= 'U015000001' AND smembershipuid <= 'U020000000';

UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid >= 'U020000001' AND smembershipuid <= 'U025000000';

UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid >= 'U025000001' AND smembershipuid <= 'U030000000';

UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid >= 'U030000001' AND smembershipuid <= 'U035000000';

UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid >= 'U035000001' AND smembershipuid <= 'U040000000';

UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid >= 'U040000001' AND smembershipuid <= 'U045000000';

UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid >= 'U045000001' AND smembershipuid <= 'U050000000';

-- 3) 잔여(패딩/범위 밖 UID)
UPDATE wootartestwootargetsample
SET singestymd = '20260824',
    ilineno = CAST(SUBSTRING(smembershipuid, 2, 9) AS INTEGER)
WHERE smembershipuid LIKE 'U%'
  AND (ilineno IS NULL OR ilineno = 0
       OR singestymd IS NULL OR btrim(singestymd) = '');

-- 4) 확인. need_fill = 0, min_line = 1
SELECT
  COUNT(*) FILTER (
    WHERE ilineno IS NULL OR ilineno < 1
       OR singestymd IS NULL OR btrim(singestymd) = ''
       OR length(btrim(singestymd)) <> 8
  ) AS need_fill,
  MIN(ilineno) AS min_line,
  MAX(ilineno) AS max_line,
  MIN(singestymd) AS min_ymd,
  MAX(singestymd) AS max_ymd
FROM wootartestwootargetsample;
