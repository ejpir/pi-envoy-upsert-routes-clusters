import { PROGRESS_EVENT_LIMIT } from "./constants.ts";
import { summarizeProgressCommand, summarizeProgressText } from "./progress.ts";
import {
  compactUsageFooterSummary,
  createEmptyUsageStats,
  createEmptyWorkflowUsageTotals,
} from "./usage.ts";
import {
  compactWorkflowResultSummary,
  isApproveWorkflowCommand,
  prettyState,
} from "./workflow.ts";
import type {
  ApplyAuditTrail,
  SubagentProgress,
  UpsertWorkflowResult,
  WorkflowRunKind,
  WorkflowUsageTotals,
} from "./types.ts";

export type WorkflowPhase = "idle" | "planning" | "applying" | "ready";

export type ExtensionState = {
  guardEnabled: boolean;
  blockedCount: number;
  workflowAttempted: boolean;
  approvalGranted: boolean;
  latestWorkflowResult: UpsertWorkflowResult | null;
  lastApplyAudit: ApplyAuditTrail | null;
  approvalPromptShown: boolean;
  approvalPromptActive: boolean;
  approvalDenied: boolean;
  workflowPhase: WorkflowPhase;
  subagentSessionDir: string | null;
  subagentSessionFile: string | null;
  activeWorkflowRunKind: WorkflowRunKind | null;
  lastWorkflowRunKind: WorkflowRunKind | null;
  workflowUsageTotals: WorkflowUsageTotals;
  subagentProgress: SubagentProgress;
  workflowCommandsByCallId: Map<string, string>;
  workflowUiHandledByCallId: Set<string>;
};

function createExtensionState(): ExtensionState {
  return {
    guardEnabled: false,
    blockedCount: 0,
    workflowAttempted: false,
    approvalGranted: false,
    latestWorkflowResult: null,
    lastApplyAudit: null,
    approvalPromptShown: false,
    approvalPromptActive: false,
    approvalDenied: false,
    workflowPhase: "idle",
    subagentSessionDir: null,
    subagentSessionFile: null,
    activeWorkflowRunKind: null,
    lastWorkflowRunKind: null,
    workflowUsageTotals: createEmptyWorkflowUsageTotals(),
    subagentProgress: createIdleSubagentProgress(),
    workflowCommandsByCallId: new Map<string, string>(),
    workflowUiHandledByCallId: new Set<string>(),
  };
}

function createIdleSubagentProgress(): SubagentProgress {
  return {
    phase: "idle",
    status: "Idle",
    detail: "",
    reads: 0,
    bashCalls: 0,
    usage: createEmptyUsageStats(),
    events: [],
  };
}

function resetSubagentProgress(state: ExtensionState): void {
  state.subagentProgress = createIdleSubagentProgress();
}

function resetWorkflowUsage(state: ExtensionState): void {
  state.activeWorkflowRunKind = null;
  state.lastWorkflowRunKind = null;
  state.workflowUsageTotals = createEmptyWorkflowUsageTotals();
}

function resetWorkflowState(
  state: ExtensionState,
  options: {
    enabled: boolean;
    attempted: boolean;
    approved: boolean;
  },
): void {
  state.guardEnabled = options.enabled;
  state.blockedCount = 0;
  state.workflowAttempted = options.attempted;
  state.approvalGranted = options.approved;
  state.approvalDenied = false;
  state.approvalPromptShown = false;
  state.approvalPromptActive = false;
  state.latestWorkflowResult = null;
  state.lastApplyAudit = null;
  state.workflowPhase = "idle";
  state.workflowCommandsByCallId.clear();
  state.workflowUiHandledByCallId.clear();
  resetSubagentProgress(state);
  resetWorkflowUsage(state);
}

function pushSubagentEvent(state: ExtensionState, message: string): void {
  const line = summarizeProgressText(message, 120);
  if (!line) {
    return;
  }
  state.subagentProgress.events.push(line);
  while (state.subagentProgress.events.length > PROGRESS_EVENT_LIMIT) {
    state.subagentProgress.events.shift();
  }
}

function setSubagentProgress(state: ExtensionState, update: Partial<SubagentProgress>): void {
  state.subagentProgress = {
    ...state.subagentProgress,
    ...update,
    events: update.events ?? state.subagentProgress.events,
  };
}

function beginWorkflowRun(state: ExtensionState, command: string): void {
  state.activeWorkflowRunKind = isApproveWorkflowCommand(command) ? "applying" : "planning";
  state.workflowPhase = state.activeWorkflowRunKind;
  state.latestWorkflowResult = null;
  if (state.activeWorkflowRunKind === "planning") {
    state.lastApplyAudit = null;
  }
  setSubagentProgress(state, {
    phase: "starting",
    status: state.activeWorkflowRunKind === "applying" ? "Applying workflow" : "Planning workflow",
    detail: summarizeProgressCommand(command),
  });
}

function finalizeWorkflowRun(state: ExtensionState, workflowResult: UpsertWorkflowResult | null): void {
  state.workflowPhase = "ready";
  if (state.activeWorkflowRunKind) {
    state.lastWorkflowRunKind = state.activeWorkflowRunKind;
  }
  state.activeWorkflowRunKind = null;

  if (workflowResult) {
    state.latestWorkflowResult = workflowResult;
    state.subagentProgress = {
      ...state.subagentProgress,
      phase: "ready",
      status: compactWorkflowResultSummary(workflowResult),
      detail: workflowResult.target_virtual_host ? `target ${workflowResult.target_virtual_host}` : "",
    };
    return;
  }

  state.subagentProgress = {
    ...state.subagentProgress,
    phase: "ready",
    status: "Workflow finished",
    detail: "",
  };
}

function guardStatus(state: ExtensionState): string {
  const parts = ["upsert-guard", `blocked=${state.blockedCount}`];
  if (state.workflowPhase === "planning") parts.push("planning");
  else if (state.workflowPhase === "applying") parts.push("applying");
  else if (state.latestWorkflowResult) parts.push(prettyState(state.latestWorkflowResult).toLowerCase());

  const usageSummary = compactUsageFooterSummary(
    state.workflowPhase === "planning" || state.workflowPhase === "applying"
      ? state.subagentProgress.usage
      : state.workflowUsageTotals.cumulative,
  );

  if (state.workflowPhase === "planning" || state.workflowPhase === "applying") {
    parts.push(state.subagentProgress.status.toLowerCase());
    if (state.subagentProgress.reads > 0) parts.push(`read=${state.subagentProgress.reads}`);
    if (state.subagentProgress.bashCalls > 0) parts.push(`bash=${state.subagentProgress.bashCalls}`);
    if (usageSummary) parts.push(usageSummary);
    parts.push("/upsert-workflow-ui");
  } else if (usageSummary) {
    parts.push(usageSummary);
  }

  return parts.join(" · ");
}

export {
  beginWorkflowRun,
  createExtensionState,
  finalizeWorkflowRun,
  guardStatus,
  pushSubagentEvent,
  resetSubagentProgress,
  resetWorkflowState,
  resetWorkflowUsage,
  setSubagentProgress,
};
