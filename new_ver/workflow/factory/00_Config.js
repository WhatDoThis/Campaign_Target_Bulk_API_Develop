/* ============================================================================
 * TBAWFactory / 00_Config (Factory 설정)
 * ============================================================================
 * 설정은 이 파일 상단 FACTORY_CFG + 라이브러리 BULK_CFG.
 * xtk:option 은 워커 상태 핸드셰이크에만 쓴다 (설정 조회 없음).
 *
 * 캔버스:
 *   Start → 00 → 01_Distributor → 02_Polling → 03_Test
 *     Test working → 1m Wait → 02
 *     Test next    → 01
 *     Test finish  → End
 *   03_Test 조건: instance.vars.nextAction == 'working' | 'next' | 'finish'
 *
 * 워커 WF: TBAW1 .. TBAWn. 항상 시작됨(state=11). 활동명 sigWorker.
 *   코드는 workflow/worker/worker.js. PostEvent complete=false.
 *
 * [Main Functions]
 * 1. FACTORY_CFG — 라운드·워커 수·상한. 물량 조절 지점
 * 2. BULK_CFG 정합 — 스키마·배치 크기·스로틀 미리보기
 * 3. instance.vars 전파 — 01/02 가 읽는 문자열 계약
 *
 * [Dependencies]
 * wootar:testWooBulkApiWorker.js
 * ==========================================================================*/

loadLibrary("wootar:testWooBulkApiWorker.js", false);

// # 1. [Config] 운영자가 만지는 값만 이 객체. 01/02 는 instance.vars 만 본다.
var FACTORY_CFG = {

  /* --- [F1] 워커 규모. 가드레일: 1 ~ WORKER_MAX ---------------------- */
  // WORKER_COUNT: 이번 운영에 쓸 TBAWn 개수. 초기 5, 이후 6..15 로 늘림.
  //   가드레일: 1 미만 → 1. WORKER_MAX 초과 → WORKER_MAX 로 클램프 (로그 WARN)
  //   늘릴 때: TBAWn WF 를 먼저 Start(state=11) 한 뒤 이 값을 올린다.
  //   Start 안 된 n 은 01 이 skip. 스로틀 workerCount 는 실발사 수
  WORKER_COUNT  : 5,

  // WORKER_MAX: 동시 워커 상한. 최대 15.
  //   가드레일: Adobe Target bulk update 50콜/분(계정 공유) × SAFETY_RATIO 0.7
  //   15개 기준 워커당 ≈25.7초 간격. 라이브러리 BULK_CFG.WORKER_MAX 와 같게 유지
  WORKER_MAX    : 15,

  /* --- [F2] 물량 상한. 이번 실행 500만 건 (pending UID 오름차순) -------- */
  // ROUND_LIMIT: 한 라운드에서 워커에 나눠 줄 pending 행 수 (정렬 목록의 앞 N건).
  //   GRAND_TOTAL 과 같게 두면 한 라운드에 목표 건수를 다 넣는다.
  //   가드레일: 1 미만이면 5000000. GrandTotal 잔여보다 크면 잔여로 잘림
  ROUND_LIMIT   : 500000,

  // GRAND_TOTAL: 이 Factory 실행의 누적 성공 sent 상한. 02 가 워커 보고 sent 합으로 판정.
  //   0 = 무제한 (pending 이 없을 때까지 라운드 반복)
  //   5000000 = 지금 pending 을 membershipUid 오름차순으로 앞에서 500만 건만 전송
  //   시작점은 테이블 첫 행이 아니라 apiYn N/NULL 인 가장 앞 UID
  GRAND_TOTAL   : 5000000,

  /* --- [F3] 분할. prefix/자릿수 없음. 복잡한 고객번호도 동일 ----------- */
  // 01 은 pending 을 @membershipUid 오름차순으로 두고 startLine(offset) 으로 경계를 찍는다.
  //   워커·라이브러리 조회도 같은 orderBy. CSV 행 순서는 UID 오름차순
  //   PRD 고객번호가 숫자가 아니어도 됨. 정렬은 스키마 문자열 순서(콜레이션)
  // EXACT_COUNT: true 면 pending count 로 remaining 을 자른다. 5천만 count 는 비쌈
  EXACT_COUNT   : false,

  /* --- [F4] 워커 WF 이름. {n} = 1..WORKER_COUNT ---------------------- */
  // WORKER_WF: PostEvent 대상 내부명. TBAW1, TBAW2, ...
  // WORKER_NAME: 로그·batchName·Option 키에 쓰는 워커 식별자. 보통 WF 명과 동일
  // WORKER_SIG: 각 워커 캔버스의 시그널 활동명. 복사 배포면 전부 sigWorker
  WORKER_WF     : "TBAW{n}",
  WORKER_NAME   : "TBAW{n}",
  WORKER_SIG    : "sigWorker",

  /* --- [F5] 상태 Option / 폴링. 설정값이 아니라 핸드셰이크 ----------- */
  // OPT_PREFIX: setOption 키 = prefix + workerName → WORKER_DONE_TBAW1
  //   가드레일: 설정 저장소로 쓰지 않음. 값 형식은 {runId}|status[|sent|failed]
  OPT_PREFIX    : "WORKER_DONE_",

  // STRICT_RUNID: Option 의 runId 가 이번 라운드와 다르면 stale → 계속 대기.
  //   가드레일: true 유지. false 면 이전 라운드 done 잔존으로 폴링이 일찍 끝남
  STRICT_RUNID  : true,

  // ABORT_ON_ERR: 한 워커 error 시 Factory throw.
  //   false = 그 워커만 제외. apiYn=N 잔여는 다음 라운드 재처리 (권장)
  ABORT_ON_ERR  : false,

  // MAX_READY: status=ready 가 이 횟수(Wait 1m 기준 분) 지속되면 signal timeout.
  //   가드레일: 워커 WF 미시작/정지를 무한 대기하지 않음. 기본 5분
  MAX_READY     : 5,

  // MAX_RUN: 라운드 전체 폴링 횟수. 초과 시 ROUND_TIMEOUT 으로 pending 을 끊음.
  //   가드레일: Wait 1m × 360 = 6시간. 500만 건·워커5 는 1~3시간 예상, OFFSET 조회 포함
  MAX_RUN       : 360,

  // STAGGER_POST: PostEvent 사이 sleep(ms). 라이브러리 첫 POST 분산과 별개.
  //   가드레일: 0 이면 발사 간격 없음. 동시 기동 폭주는 STAGGER_SLOT_MS 가 1차 방어
  STAGGER_POST  : 300,

  /* --- [F6] 배치 행수 ------------------------------------------------- */
  // BATCH_SIZE: 워커 1회 조회/POST 행수. 시그널 batchSize 로 전달.
  //   가드레일: 0 = BULK_CFG.BATCH_SIZE (5000). 최종 1 ~ Target LIMIT_ROWS(500000)
  BATCH_SIZE    : 0
};

// # 2. [Validate] 라이브러리·워커 수·배치 상한. 실패 시 throw 로 Factory 기동을 막는다.
if (typeof BULK_CFG === "undefined" || typeof BulkApiWorker !== "function") {
  throw new Error("[Config] wootar:testWooBulkApiWorker.js 로드 실패 — JS 내부명 확인");
}

var wCount = parseInt(FACTORY_CFG.WORKER_COUNT, 10) || 5;
var wMax   = parseInt(FACTORY_CFG.WORKER_MAX, 10) || 15;
if (wCount < 1) wCount = 1;
if (wCount > wMax) {
  logWarning("[Config] WORKER_COUNT " + wCount + " > WORKER_MAX " + wMax
    + " → " + wMax + "으로 제한");
  wCount = wMax;
}

var schema = String(BULK_CFG.MEMBER_SCHEMA || "");
if (schema.indexOf(":") < 0) {
  throw new Error("[Config] MEMBER_SCHEMA 형식 오류: '" + schema + "'");
}

var batch = parseInt(FACTORY_CFG.BATCH_SIZE, 10) || 0;
if (batch < 1) batch = parseInt(BULK_CFG.BATCH_SIZE, 10) || 5000;
if (batch < 1) batch = 1;
if (batch > parseInt(BULK_CFG.LIMIT_ROWS, 10)) {
  throw new Error("[Config] BATCH_SIZE " + batch + " > Target 상한");
}

// 미리보기용. 실제 간격은 워커가 시그널 workerCount(실발사 수)로 다시 계산한다.
var cpm = (BULK_CFG.ACCOUNT_CPM * BULK_CFG.SAFETY_RATIO) / wCount;
var throttleMs = Math.ceil(60000 / (cpm > 0 ? cpm : 1));

// # 3. [Vars] Campaign instance.vars 는 문자열. 01/02 는 NUM()/==="true" 로 복원.
instance.vars.MEMBER_SCHEMA  = schema;
instance.vars.MEMBER_ELEMENT = String(BULK_CFG.MEMBER_ELEMENT || schema.split(":")[1]);
instance.vars.MEMBER_TABLE   = String(BULK_CFG.MEMBER_TABLE || "");
instance.vars.PENDING_COND   = "(@apiYn = 'N' OR @apiYn IS NULL)";
instance.vars.WORKER_COUNT   = wCount;
instance.vars.WORKER_MAX     = wMax;
instance.vars.BATCH_SIZE     = batch;
instance.vars.ROUND_LIMIT    = parseInt(FACTORY_CFG.ROUND_LIMIT, 10) || 5000000;
instance.vars.GRAND_TOTAL    = parseInt(FACTORY_CFG.GRAND_TOTAL, 10) || 0;
instance.vars.EXACT_COUNT    = FACTORY_CFG.EXACT_COUNT ? "true" : "false";
instance.vars.WORKER_WF_TPL  = String(FACTORY_CFG.WORKER_WF);
instance.vars.WORKER_NAME_TPL= String(FACTORY_CFG.WORKER_NAME);
instance.vars.WORKER_SIG     = String(FACTORY_CFG.WORKER_SIG || "sigWorker");
instance.vars.OPT_PREFIX     = String(FACTORY_CFG.OPT_PREFIX || "WORKER_DONE_");
instance.vars.STRICT_RUNID   = FACTORY_CFG.STRICT_RUNID ? "true" : "false";
instance.vars.ABORT_ON_WORKER_ERROR = FACTORY_CFG.ABORT_ON_ERR ? "true" : "false";
instance.vars.MAX_READY_POLL = parseInt(FACTORY_CFG.MAX_READY, 10) || 5;
instance.vars.MAX_RUN_POLL   = parseInt(FACTORY_CFG.MAX_RUN, 10) || 360;
instance.vars.STAGGER_POST_MS= parseInt(FACTORY_CFG.STAGGER_POST, 10) || 0;
instance.vars.CUSTOM_ATTR    = String(BULK_CFG.CUSTOM_ATTR || "");
instance.vars.round          = 0;   // 01 이 라운드마다 +1
instance.vars.globalProcessed= 0;   // 02 가 sent 합을 누적
instance.vars.pollCount      = 0;   // 02 가 라운드마다 0 으로 리셋 후 +1
instance.vars.nextAction     = "";

logInfo("[Config] 워커 " + wCount + "/" + wMax
  + " / batch " + batch
  + " / roundLimit " + instance.vars.ROUND_LIMIT
  + " / grandTotal " + instance.vars.GRAND_TOTAL
  + " / 스로틀 ~" + throttleMs + "ms"
  + " / custom=" + (instance.vars.CUSTOM_ATTR || "(none)")
  + " / schema " + schema);
