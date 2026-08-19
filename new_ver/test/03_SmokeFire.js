/* ============================================================================
 * TBAWSmoke / 03_Fire
 * 별도 워크플로우(TBAWSmokeSignal)의 sigWorker 활동으로 이벤트를 발사한다.
 *
 * [주의] PostEvent는 비동기이며, 대상 WF가 '시작됨' 상태가 아니면
 *        예외 없이 로그에만 에러를 남긴다. 사전에 상태를 검증한다.
 *        complete 인자는 반드시 false — true면 대상이 완료 상태로 전환되어
 *        다음 회차에 시그널을 받지 못한다.
 * ==========================================================================*/

logInfo("=== T7 Signal Dispatch === (진입)");   // ★ 무조건 첫 줄에 찍는다

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
logInfo("  대상 WF=" + SIG_WF + " / 활동=" + SIG_ACT + " / 옵션키=" + OPT_KEY);

if (instance.vars.smkTSignal !== "1") {
  logInfo("  [SKIP] T7 :: 스위치 OFF");
  setOption(OPT_KEY, "skip", "smoke worker status");
} else {
  var canFire = false;

  /* --- 대상 워크플로우 상태 사전 검증 ---------------------------------
   * @state 상수는 인스턴스/버전에 따라 다를 수 있으므로
   * 실패 시 후보 워크플로우 목록을 함께 출력해 값을 눈으로 확인한다.
   * ------------------------------------------------------------------*/
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

    ok("시그널 WF 존재", wfId > 0, SIG_WF + " (id=" + wfId + ", label=" + wf.@label + ")");
    ok("시그널 WF 시작됨", wfState === 20,
       "state=" + wfState + (wfState !== 20 ? " ← TBAWSmokeSignal 을 '시작' 할 것" : ""));
    canFire = (wfId > 0 && wfState === 20);

    // 못 찾았으면 내부명 오타 진단을 위해 유사 목록 출력
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
    setOption(OPT_KEY, "error", "smoke worker status");
    logWarning("  발사 생략 — 대상 워크플로우가 수신 가능 상태가 아님");
  } else {
    try {
      var UIDP = String(instance.vars.smkUidPrefix);
      var UIDD = parseInt(instance.vars.smkUidDigits, 10) || 9;
      function pad(n) { var s = String(n); while (s.length < UIDD) s = "0" + s; return UIDP + s; }

      var minUid = String(instance.vars.smkMinUid || pad(1));
      var s0  = parseInt(minUid.substring(UIDP.length), 10) || 1;
      var lim = parseInt(instance.vars.smkLimit, 10) || 300;

      var params = <variables
          workerName="SMOKE"
          uidStart={pad(s0)}
          uidEnd={pad(s0 + lim - 1)}
          runId={String(instance.vars.smkRunId)}
          optKey={OPT_KEY}
          batchSize={String(instance.vars.smkBatch)}
          dryRun="true"/>;

      logInfo("  발사 파라미터: " + params.toXMLString());
      setOption(OPT_KEY, "ready", "smoke worker status");

      xtk.workflow.PostEvent(SIG_WF, SIG_ACT, "", params, false);

      ok("PostEvent 발사", true,
         SIG_WF + "/" + SIG_ACT + " " + pad(s0) + " ~ " + pad(s0 + lim - 1));
    } catch (e) {
      ok("PostEvent 발사", false, e.toString());
      setOption(OPT_KEY, "error", "smoke worker status");
    }
  }
}

instance.vars.smkPass  = PASS;
instance.vars.smkFail  = FAIL;
instance.vars.smkFails = FAILS;
logInfo("=== T7 종료 === 누적 PASS=" + PASS + " FAIL=" + FAIL);
