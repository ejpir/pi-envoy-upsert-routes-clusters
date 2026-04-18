import { describe, expect, test } from "bun:test";
import { WORKFLOW_SCRIPT_PATH } from "../constants.ts";
import {
  beginWorkflowRun,
  createExtensionState,
  finalizeWorkflowRun,
  guardStatus,
  pushSubagentEvent,
  resetWorkflowState,
} from "../state.ts";

describe("state.ts", () => {
  test("creates idle default state", () => {
    const state = createExtensionState();

    expect(state.guardEnabled).toBe(false);
    expect(state.workflowPhase).toBe("idle");
    expect(state.subagentProgress.status).toBe("Idle");
    expect(state.workflowCommandsByCallId.size).toBe(0);
    expect(state.workflowUiHandledByCallId.size).toBe(0);
  });

  test("beginWorkflowRun updates phase and progress summary", () => {
    const state = createExtensionState();

    beginWorkflowRun(state, `python3 ${WORKFLOW_SCRIPT_PATH} --approve`);

    expect(state.activeWorkflowRunKind).toBe("applying");
    expect(state.workflowPhase).toBe("applying");
    expect(state.subagentProgress.phase).toBe("starting");
    expect(state.subagentProgress.detail).toBe("run_workflow.py --approve");
  });

  test("finalizeWorkflowRun stores latest result and readable summary", () => {
    const state = createExtensionState();
    beginWorkflowRun(state, `python3 ${WORKFLOW_SCRIPT_PATH}`);

    finalizeWorkflowRun(state, {
      schema_version: "upsert-workflow-v1",
      next_step: "apply",
      state: "WAITING_APPROVAL",
      target_virtual_host: "dtap_apps",
      summary: {
        add_routes: 2,
        add_clusters: 1,
      },
    });

    expect(state.workflowPhase).toBe("ready");
    expect(state.lastWorkflowRunKind).toBe("planning");
    expect(state.activeWorkflowRunKind).toBeNull();
    expect(state.latestWorkflowResult?.target_virtual_host).toBe("dtap_apps");
    expect(state.subagentProgress.status).toBe("Approval needed · 2 route(s), 1 cluster(s)");
    expect(state.subagentProgress.detail).toBe("target dtap_apps");
  });

  test("pushSubagentEvent keeps only the most recent entries", () => {
    const state = createExtensionState();

    for (let index = 1; index <= 10; index += 1) {
      pushSubagentEvent(state, `event ${index}`);
    }

    expect(state.subagentProgress.events).toEqual([
      "event 5",
      "event 6",
      "event 7",
      "event 8",
      "event 9",
      "event 10",
    ]);
  });

  test("resetWorkflowState clears transient state", () => {
    const state = createExtensionState();
    state.guardEnabled = true;
    state.workflowAttempted = true;
    state.approvalDenied = true;
    state.blockedCount = 7;
    state.workflowCommandsByCallId.set("call-1", "cmd");
    state.workflowUiHandledByCallId.add("call-1");
    state.workflowUsageTotals.cumulative.input = 123;
    state.lastApplyAudit = {
      mode: "direct",
      timestamp: "2026-04-18T12:00:00.000Z",
      logPath: ".pi/logs/upsert-workflow-audit.jsonl",
      selectedItemIndexes: [0],
      selectedCount: 1,
      requestCount: 1,
      selectedSummaries: ["/app/demo • [http/path] • 1 route(s) • cluster"],
      selectedContexts: ["/app/demo"],
      routeCount: 1,
      clusterCount: 1,
      warningCount: 0,
      targetVirtualHost: "dtap_apps",
      resultState: "APPLIED",
    };

    resetWorkflowState(state, {
      enabled: true,
      attempted: false,
      approved: true,
    });

    expect(state.guardEnabled).toBe(true);
    expect(state.workflowAttempted).toBe(false);
    expect(state.approvalGranted).toBe(true);
    expect(state.approvalDenied).toBe(false);
    expect(state.blockedCount).toBe(0);
    expect(state.workflowCommandsByCallId.size).toBe(0);
    expect(state.workflowUiHandledByCallId.size).toBe(0);
    expect(state.workflowUsageTotals.cumulative.input).toBe(0);
    expect(state.lastApplyAudit).toBeNull();
  });

  test("guardStatus includes live and cumulative usage summaries", () => {
    const state = createExtensionState();
    state.guardEnabled = true;
    state.workflowPhase = "planning";
    state.blockedCount = 2;
    state.subagentProgress.status = "Planning workflow";
    state.subagentProgress.reads = 3;
    state.subagentProgress.bashCalls = 1;
    state.subagentProgress.usage.input = 1200;
    state.subagentProgress.usage.output = 300;
    state.subagentProgress.usage.cost = 0.0123;
    state.subagentProgress.usage.turns = 1;

    expect(guardStatus(state)).toContain("blocked=2");
    expect(guardStatus(state)).toContain("planning");
    expect(guardStatus(state)).toContain("Σ1.5k $0.0123");
    expect(guardStatus(state)).toContain("/upsert-workflow-ui");

    state.workflowPhase = "ready";
    state.workflowUsageTotals.cumulative.input = 2000;
    state.workflowUsageTotals.cumulative.output = 500;
    state.workflowUsageTotals.cumulative.cost = 0.02;
    state.workflowUsageTotals.cumulative.turns = 1;

    expect(guardStatus(state)).toContain("Σ2.5k $0.0200");
  });
});
