// ============================================================
// 메인 JS — 전체 건수 계산 → N개 워커에 동적 분배 → PostEvent
// ============================================================

// 커스텀 변수
instance.vars.WORKER_COUNT = 5;
instance.vars.TOTAL_LIMIT  = 500000;
instance.vars.BATCH_SIZE   = 5000;

var WORKER_COUNT = instance.vars.WORKER_COUNT;
var TOTAL_LIMIT  = instance.vars.TOTAL_LIMIT;

// apiYn='N' 미전송 건수
var cntQuery = xtk.queryDef.create(
  <queryDef schema="lgu:lgu_member" operation="count" distinct="true">
    <select>
      <node expr="@membershipUid"/>
    </select>
    <where>
      <condition expr="@apiYn = 'N' OR @apiYn IS NULL"/>
    </where>
  </queryDef>
);
var totalPending = parseInt(cntQuery.ExecuteQuery().@count);
logInfo("API 대상 건수: " + totalPending);

var remaining = Math.min(TOTAL_LIMIT, totalPending);

if (remaining <= 0) {
  logInfo("처리할 데이터 없음. 종료.");
  instance.vars.allDone = "true";
} else {
  instance.vars.allDone = "false";

  // apiYn='N'인 UID 목록에서 워커별 경계 UID 추출
  var perWorker = Math.ceil(remaining / WORKER_COUNT);
  var activeWorkers = 0;
  var workerNames = [];

  for (var w = 0; w < WORKER_COUNT; w++) {
    var wOffset = w * perWorker;
    var wSize   = Math.min(perWorker, remaining - wOffset);

    if (wSize <= 0) {
      logInfo("Worker TBAW" + (w + 1) + ": 할당 없음 (skip)");
      continue;
    }

    // 시작 UID 조회
    var startQuery = xtk.queryDef.create(
      <queryDef schema="lgu:lgu_member" operation="select" distinct="true"
                startLine={String(wOffset)} lineCount="1">
        <select>
          <node expr="@membershipUid"/>
        </select>
        <where>
          <condition expr="@apiYn = 'N' OR @apiYn IS NULL"/>
        </where>
        <orderBy>
          <node expr="@membershipUid" sortDesc="false"/>
        </orderBy>
      </queryDef>
    );
    var startResult = startQuery.ExecuteQuery();
    var uidStart = "";
    for each (var s in startResult.lgu_member) {
      uidStart = s.@membershipUid.toString();
    }

    // 끝 UID 조회
    var isLastWorker = (w == WORKER_COUNT - 1) || (wOffset + wSize >= remaining);

    if (isLastWorker) {
      // 마지막 워커: TOTAL_LIMIT 범위 내의 마지막 UID를 정확히 조회
      var endQuery = xtk.queryDef.create(
        <queryDef schema="lgu:lgu_member" operation="select" distinct="true"
                  startLine={String(remaining - 1)} lineCount="1">
          <select>
            <node expr="@membershipUid"/>
          </select>
          <where>
            <condition expr="@apiYn = 'N' OR @apiYn IS NULL"/>
          </where>
          <orderBy>
            <node expr="@membershipUid" sortDesc="false"/>
          </orderBy>
        </queryDef>
      );
    } else {
      // 나머지 워커: 기존 offset 방식
      var endQuery = xtk.queryDef.create(
        <queryDef schema="lgu:lgu_member" operation="select" distinct="true"
                  startLine={String(wOffset + wSize - 1)} lineCount="1">
          <select>
            <node expr="@membershipUid"/>
          </select>
          <where>
            <condition expr="@apiYn = 'N' OR @apiYn IS NULL"/>
          </where>
          <orderBy>
            <node expr="@membershipUid" sortDesc="false"/>
          </orderBy>
        </queryDef>
      );
    }

    var endResult = endQuery.ExecuteQuery();
    var uidEnd = "";
    for each (var e in endResult.lgu_member) {
      uidEnd = e.@membershipUid.toString();
    }

    if (!uidStart || !uidEnd) {
      logWarning("Worker TBAW" + (w + 1) + ": UID 범위 조회 실패 (skip)");
      continue;
    }

    var wName = "TBAW" + (w + 1);
    setOption("WORKER_DONE_" + wName, "ready");

    xtk.workflow.PostEvent(
      wName,
      "signal" + wName,
      "",
      <variables uidStart={uidStart} uidEnd={uidEnd} 
                 workerName={wName}
                 batchSize={String(instance.vars.BATCH_SIZE)}/>,
      false
    );

    activeWorkers++;
    workerNames.push(wName);
    logInfo("Worker " + wName + " 트리거: " + uidStart + " ~ " + uidEnd + " (" + wSize + "건)");
  }

  instance.vars.activeWorkers = activeWorkers;
  instance.vars.workerNames = workerNames.join(",");
  instance.vars.roundSize = remaining;
  logInfo("트리거 완료: " + activeWorkers + "개 워커, 총 " + remaining + "건");
}
