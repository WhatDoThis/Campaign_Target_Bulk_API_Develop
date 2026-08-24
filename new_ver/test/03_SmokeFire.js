/* ============================================================================
 * TBAWSmoke / 03_Fire (시그널 발사)
 * TBAWSmokeSignal 의 sigWorker 로 PostEvent. dryRun=false, pending 큐 키 소수 실전송.
 *
 * [주의] 대상 WF가 '시작됨'(state=11)이 아니면 예외 없이 로그만 남는다.
 *        complete 인자는 false. true면 대상이 완료되어 다음 시그널을 못 받는다.
 *
 * [Dependencies]
 * xtk.workflow.PostEvent, xtk.queryDef, setOption(상태 {runId}|status 만)
 * ==========================================================================*/

logInfo("=== T7 Signal Dispatch ===");

var PASS  = parseInt(instance.vars.smkPass, 10) || 0;
var FAIL  = parseInt(instance.vars.smkFail, 10) || 0;
var FAILS = String(instance.vars.smkFails || "");
function ok(n, c, d) {
  if (c) { PASS++; logInfo("  [PASS] " + n + (d ? " :: " + d : "")); }
  else   { FAIL++; FAILS += (FAILS ? ", " : "") + n; logWarning("  [FAIL] " + n + (d ? " :: " + d : "")); }
}

var SIG_WF  = String(instance.vars.smkSigWf || "");
var SIG_ACT = String(instance.vars.smkSigAct || "");
var OPT_KEY = String(instance.vars.smkOptKey || "");
var RUN_ID  = String(instance.vars.smkRunId || "");
logInfo("  대상 WF=" + SIG_WF + " / 활동=" + SIG_ACT + " / 옵션키=" + OPT_KEY);

function mark(st) {
  try { setOption(OPT_KEY, RUN_ID + "|" + st, "smoke worker status"); } catch (e) {}
}

if (instance.vars.smkTSignal !== "1") {
  logInfo("  [SKIP] T7 :: 스위치 OFF");
  mark("skip");
} else {
  var canFire = false;

  try {
    var wf = xtk.queryDef.create(
      <queryDef schema="xtk:workflow" operation="getIfExists">
        <select><node expr="@id"/><node expr="@internalName"/>
                <node expr="@state"/><node expr="@label"/></select>
        <where><condition expr={"@internalName = '" + SIG_WF + "'"}/></where>
      </queryDef>).ExecuteQuery();

    var wfId    = parseInt(wf.@id, 10) || 0;
    var wfState = parseInt(wf.@state, 10);
    if (isNaN(wfState)) wfState = -1;

    // WF state: 11=시작됨(시그널 수신 가능) / 13=일시중지 / 20=중지
    // PostEvent complete 인자는 반드시 false. true 면 대상이 완료되어 재수신 불가
    var started = (wfState === 11);
    ok("시그널 WF 존재", wfId > 0, SIG_WF + " (id=" + wfId + ", label=" + wf.@label + ")");
    ok("시그널 WF 시작됨", started,
       "state=" + wfState + (started ? " (started)" : " ← 11=started, 13=pause, 20=stop. TBAWSmokeSignal 을 Start"));
    canFire = (wfId > 0 && started);

    if (wfId === 0) {
      var lst = xtk.queryDef.create(
        <queryDef schema="xtk:workflow" operation="select" lineCount="20">
          <select><node expr="@internalName"/><node expr="@state"/></select>
          <where><condition expr="@internalName like 'TBAW%'"/></where>
        </queryDef>).ExecuteQuery();
      for each (var x in lst.workflow) {
        logInfo("    후보: " + x.@internalName + " (state=" + x.@state + ")");
      }
    }
  } catch (e) {
    ok("시그널 WF 상태 조회", false, e.toString());
  }

  if (!canFire) {
    mark("skip");
    logWarning("  발사 생략 — 대상 워크플로우가 시작됨(state=11)이 아님");
  } else {
    try {
      var SCHEMA  = String(instance.vars.smkSchema);
      var ELEMENT = String(instance.vars.smkElement);
      var PENDING = String(instance.vars.smkPending);
      var realN   = parseInt(instance.vars.smkRealRows, 10) || 2;

      var qr = xtk.queryDef.create(
        <queryDef schema={SCHEMA} operation="select" lineCount={String(realN)}>
          <select>
            <node expr="@membershipUid"/>
            <node expr="@ingestYm"/>
            <node expr="@lineNo"/>
          </select>
          <where><condition expr={PENDING}/></where>
          <orderBy>
            <node expr="@ingestYm" sortDesc="false"/>
            <node expr="@lineNo" sortDesc="false"/>
          </orderBy>
        </queryDef>
      ).ExecuteQuery();

      var uids = [];
      var ym = "";
      var lineStart = 0;
      var lineEnd = 0;
      for each (var row in qr[ELEMENT]) {
        var rowYm = String(row.@ingestYm);
        var rowLn = parseInt(String(row.@lineNo), 10) || 0;
        if (!ym) {
          ym = rowYm;
          lineStart = rowLn;
        }
        if (rowYm !== ym) break;
        uids.push(String(row.@membershipUid));
        lineEnd = rowLn;
      }
      ok("실전송 대상 pending", uids.length > 0 && ym.length === 6 && lineStart >= 1,
        "n=" + uids.length + " / 요청=" + realN + " / " + ym + " line " + lineStart + " ~ " + lineEnd);

      if (uids.length === 0 || lineStart < 1) {
        mark("skip");
      } else {
        instance.vars.smkRealYm    = ym;
        instance.vars.smkRealLineS = lineStart;
        instance.vars.smkRealLineE = lineEnd;
        instance.vars.smkRealStart = uids[0];
        instance.vars.smkRealEnd   = uids[uids.length - 1];
        instance.vars.smkRealCount = uids.length;

        var params = <variables
            workerName="SMOKE"
            ingestYm={ym}
            lineStart={String(lineStart)}
            lineEnd={String(lineEnd)}
            runId={RUN_ID}
            optKey={OPT_KEY}
            batchSize={String(uids.length)}
            dryRun="false"
            workerCount="1"
            authToken=""/>;

        logInfo("  실전송 발사: " + ym + " line " + lineStart + " ~ " + lineEnd
          + " / uid " + uids[0] + " ~ " + uids[uids.length - 1]
          + " (" + uids.length + "건)");
        logInfo("  발사 파라미터: " + params.toXMLString());
        mark("ready");
        xtk.workflow.PostEvent(SIG_WF, SIG_ACT, "", params, false);

        ok("PostEvent 실전송 발사", true,
           SIG_WF + "/" + SIG_ACT + " " + ym + " " + lineStart + " ~ " + lineEnd);
      }
    } catch (e) {
      ok("PostEvent 발사", false, e.toString());
      mark("error");
    }
  }
}

instance.vars.smkPass  = PASS;
instance.vars.smkFail  = FAIL;
instance.vars.smkFails = FAILS;
logInfo("=== T7 종료 === 누적 PASS=" + PASS + " FAIL=" + FAIL);
