// ============================================================
// [옵션 조회 헬퍼]
//   getOption(name[, useCache]) — 캐시는 기본 미사용(공식 문서).
//     false를 명시해 의도를 드러내지만 동작상 필수는 아니다.
//   반환 타입은 옵션 타입에 따름: text→String, integer→Number, 미존재→undefined.
//     따라서 Number/String 양쪽을 모두 처리해야 한다.
//   integer 옵션의 함정: 값을 비워두면 ""가 아니라 0이 저장된다.
//     → 0을 '미설정'으로 볼 항목은 cfgPos(양수만 유효),
//       0을 유효값으로 볼 항목(GrandTotal)은 cfgNum을 사용한다.
// ============================================================
function optRaw(key) {
    var v;
    try { v = getOption(OPT_PREFIX + key, false); } catch (e) { v = undefined; }
    if (v === undefined || v === null) return "";
    return String(v).replace(/^\s+|\s+$/g, "");
  }
  // 문자열: 빈 값이면 기본값
  function cfg(key, def) {
    var v = optRaw(key);
    return (v == "") ? String(def) : v;
  }
  // 숫자(0 허용): GrandTotal처럼 0이 유효한 의미를 갖는 항목
  function cfgNum(key, def) {
    var v = optRaw(key);
    if (v == "") return def;
    var n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  }
  // 숫자(양수만): 0 또는 음수는 미설정으로 간주해 기본값 사용
  function cfgPos(key, def) {
    var n = cfgNum(key, def);
    return (n > 0) ? n : def;
  }
  // 스위치: text "true/y/yes" 또는 integer 1 을 참으로 인식
  function cfgBool(key, def) {
    var v = optRaw(key).toLowerCase();
    if (v == "") return def;
    return (v == "true" || v == "1" || v == "y" || v == "yes");
  }
  function flag(b) { return b ? "true" : "false"; }
  
  // ============================================================
  // [1] 옵션 연동 값 — 테스트→운영 시 콘솔에서 값만 변경
  //   MemberSchema : text    (스키마 키 문자열)
  //   WorkerCount  : integer (양수만 유효)
  //   BatchSize    : integer (양수만 유효)
  //   RoundLimit   : integer (양수만 유효)
  //   GrandTotal   : integer (0 = 무제한, 유효값)
  //   Enabled      : integer 1/0 또는 text true/false
  // ============================================================
  instance.vars.MEMBER_SCHEMA  = cfg("MemberSchema", "wootar:testWooTargetSample");
  instance.vars.MEMBER_ELEMENT = instance.vars.MEMBER_SCHEMA.split(":")[1];
  instance.vars.WORKER_COUNT   = cfgPos("WorkerCount", CFG_WORKER_COUNT);
  instance.vars.BATCH_SIZE     = cfgPos("BatchSize",   CFG_BATCH_SIZE);
  instance.vars.ROUND_LIMIT    = cfgPos("RoundLimit",  CFG_ROUND_LIMIT);
  instance.vars.GRAND_TOTAL    = cfgNum("GrandTotal",  CFG_GRAND_TOTAL);
  
  // 킬 스위치: 워크플로우 정지 없이 라운드 경계에서 안전 종료
  var enabled = cfgBool("Enabled", true);
  
  // 스키마 키 형식 검증 (콜론 누락 시 조회가 조용히 실패하므로 사전 차단)
  if (instance.vars.MEMBER_SCHEMA.indexOf(":") < 0) {
    throw new Error("[Config] " + OPT_PREFIX + "MemberSchema 형식 오류: '"
      + instance.vars.MEMBER_SCHEMA + "' — '네임스페이스:스키마명' 형식이어야 합니다.");
  }
  