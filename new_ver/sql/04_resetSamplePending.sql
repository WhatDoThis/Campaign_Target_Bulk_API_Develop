-- =============================================================================
-- Sample 전송 상태 롤백 (psql / 검증용)
-- Master 삭제는 별도 — Sample FK 만 되돌림
-- =============================================================================
-- ACC JS 배치: sql/04_resetSamplePending.js (권장)
--
-- [왜 lineNo 0~50M 구간 루프가 느린가]
--   대부분 행이 이미 sapiyn='N' → 구간마다 0건 UPDATE 이지만 PG 는 ilineno 범위를
--   250회(50M/200K) 스캔. 변경분 ~200만 건만 sapiyn='Y' 조건으로 찾아야 함.
--
-- [인덱스] idx_pending_queue(sapiyn, singestymd, ilineno) — sapiyn='Y' 선행 조건
-- =============================================================================

-- §1) 롤백 대상 확인 (0이 아니면 아래 UPDATE 필요)
SELECT
  COUNT(*) FILTER (WHERE sapiyn = 'Y') AS sent_y,
  COUNT(*) FILTER (WHERE sapiyn = 'N' AND imasterid > 0) AS orphan_fk,
  MAX(ilineno) FILTER (WHERE sapiyn = 'Y') AS max_line_y
FROM wootartestwootargetsample
WHERE singestymd = '20260824';

-- §2) 한 번에 (소량·dev). 대량은 04_resetSamplePending.js LIMIT 배치 사용
-- UPDATE wootartestwootargetsample
--    SET sapiyn = 'N', imasterid = 0
--  WHERE singestymd = '20260824'
--    AND sapiyn = 'Y';

-- §3) 롤백 후 pending 복구 확인
SELECT COUNT(*) AS pending_n
FROM wootartestwootargetsample
WHERE singestymd = '20260824'
  AND sapiyn = 'N'
  AND ilineno >= 1;
