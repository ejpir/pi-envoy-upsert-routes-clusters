import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBashTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Key, Text, matchesKey } from "@mariozechner/pi-tui";
import {
  DOC_READS,
  GUARD_STATUS_KEY,
  SKILL_COMMAND,
  SKILL_ROOT,
  TEMPLATE_PATH,
  WORKFLOW_DEBUG_LOG_PATH,
} from "./lib/constants.ts";
import { persistApplyAuditTrail } from "./lib/audit-log.ts";
import { buildApplyAuditTrail, compactApplyAuditSummary } from "./lib/audit.ts";
import { runDirectWorkflow } from "./lib/direct-workflow.ts";
import { appendWorkflowDebugRecord, createWorkflowDebugRunId } from "./lib/debug-log.ts";
import { findLatestWorkflowDebugRun, formatWorkflowDebugRun, parseWorkflowDebugLog } from "./lib/debug-log-view.ts";
import {
  parseNormalizedRequestPayload,
  stringifyNormalizedRequestPayload,
} from "./lib/normalization.ts";
import { runSkillSubagent } from "./lib/subagent-runner.ts";
import {
  beginWorkflowRun as beginWorkflowRunState,
  createExtensionState,
  finalizeWorkflowRun as finalizeWorkflowRunState,
  guardStatus,
  pushSubagentEvent as pushSubagentEventState,
  resetSubagentProgress as resetSubagentProgressState,
  resetWorkflowState as resetWorkflowStateState,
  setSubagentProgress as setSubagentProgressState,
} from "./lib/state.ts";
import { summarizeProgressCommand, summarizeProgressPath, summarizeProgressText } from "./lib/progress.ts";
import { buildSelectedRequestPayload } from "./lib/selection.ts";
import {
  buildProgressLines,
  requestWorkflowUi,
} from "./lib/ui.ts";
import { compactUsageFooterSummary } from "./lib/usage.ts";
import {
  asDetailRecord,
  buildWorkflowToolDetails,
  compactWorkflowResultSummary,
  hasExplicitApproval,
  isAllowedWorkflowCommand,
  isApproveWorkflowCommand,
  isWorkflowCommand,
  parseWorkflowResult,
  shouldFallbackToModelPlanning,
  shouldGuard,
  shouldOfferApproval,
} from "./lib/workflow.ts";
import type {
  ApprovalChoice,
  SubagentProgress,
  UpsertWorkflowResult,
} from "./lib/types.ts";

const bashToolCache = new Map<string, ReturnType<typeof createBashTool>>();
const CURRENT_EXTENSION_PATH = path.resolve(fileURLToPath(import.meta.url));
const PROJECT_LOCAL_EXTENSION_FILE_PATH = path.resolve(process.cwd(), ".pi/extensions/upsert-docs-only-guard.ts");
const PROJECT_LOCAL_EXTENSION_INDEX_PATH = path.resolve(process.cwd(), ".pi/extensions/upsert-docs-only-guard/index.ts");
const SHOULD_DEFER_TO_PROJECT_LOCAL = ![
  PROJECT_LOCAL_EXTENSION_FILE_PATH,
  PROJECT_LOCAL_EXTENSION_INDEX_PATH,
].includes(CURRENT_EXTENSION_PATH)
  && (existsSync(PROJECT_LOCAL_EXTENSION_FILE_PATH) || existsSync(PROJECT_LOCAL_EXTENSION_INDEX_PATH));

function getOriginalBashTool(cwd: string) {
  let tool = bashToolCache.get(cwd);
  if (!tool) {
    tool = createBashTool(cwd);
    bashToolCache.set(cwd, tool);
  }
  return tool;
}

export default function (pi: ExtensionAPI) {
  if (SHOULD_DEFER_TO_PROJECT_LOCAL) {
    return;
  }

  const state = createExtensionState();

  const syncWorkflowChrome = (ctx: any) => {
    if (!state.guardEnabled) {
      ctx.ui.setStatus(GUARD_STATUS_KEY, undefined);
      ctx.ui.setWorkingMessage();
      ctx.ui.setHiddenThinkingLabel();
      return;
    }

    ctx.ui.setStatus(GUARD_STATUS_KEY, guardStatus(state));
    if (state.workflowPhase === "planning") {
      const detail = state.subagentProgress.detail ? ` · ${state.subagentProgress.detail}` : "";
      ctx.ui.setWorkingMessage(`Preparing envoy upsert workflow… ${state.subagentProgress.status}${detail}`);
      ctx.ui.setHiddenThinkingLabel(`Envoy upsert workflow is running in the background… ${state.subagentProgress.status}${detail}`);
      ctx.ui.setToolsExpanded(false);
      return;
    }
    if (state.workflowPhase === "applying") {
      const detail = state.subagentProgress.detail ? ` · ${state.subagentProgress.detail}` : "";
      ctx.ui.setWorkingMessage(`Applying envoy upsert workflow… ${state.subagentProgress.status}${detail}`);
      ctx.ui.setHiddenThinkingLabel(`Envoy upsert apply is running in the background… ${state.subagentProgress.status}${detail}`);
      ctx.ui.setToolsExpanded(false);
      return;
    }

    ctx.ui.setWorkingMessage();
    ctx.ui.setHiddenThinkingLabel();
  };

  const setSubagentProgress = (ctx: any, update: Partial<SubagentProgress>) => {
    setSubagentProgressState(state, update);
    syncWorkflowChrome(ctx);
  };

  const beginWorkflowRun = (ctx: any, command: string) => {
    beginWorkflowRunState(state, command);
    syncWorkflowChrome(ctx);
  };

  const finalizeWorkflowRun = (ctx: any, workflowResult: UpsertWorkflowResult | null) => {
    finalizeWorkflowRunState(state, workflowResult);
    syncWorkflowChrome(ctx);
  };

  const resetWorkflowState = async (
    ctx: any,
    options: {
      enabled: boolean;
      attempted: boolean;
      approved: boolean;
    },
  ) => {
    resetWorkflowStateState(state, options);
    await cleanupSubagentSession();
    syncWorkflowChrome(ctx);
  };

  const resetSubagentProgress = () => {
    resetSubagentProgressState(state);
  };

  const pushSubagentEvent = (message: string) => {
    pushSubagentEventState(state, message);
  };

  const getPiInvocation = () => {
    const currentScript = process.argv[1];
    if (currentScript) {
      return { command: process.execPath, args: [currentScript] };
    }
    return { command: "pi", args: [] };
  };

  const ensureSubagentSession = async () => {
    if (state.subagentSessionDir && state.subagentSessionFile) {
      return state.subagentSessionFile;
    }
    const dir = await mkdtemp(path.join(tmpdir(), "pi-upsert-subagent-"));
    state.subagentSessionDir = dir;
    state.subagentSessionFile = path.join(dir, "session.jsonl");
    return state.subagentSessionFile;
  };

  const cleanupSubagentSession = async () => {
    const dir = state.subagentSessionDir;
    state.subagentSessionDir = null;
    state.subagentSessionFile = null;
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  };

  const executeNormalizationSubagent = async (ctx: any, promptText: string) => {
    const debugRunId = createWorkflowDebugRunId("planning");
    void appendWorkflowDebugRecord({
      runId: debugRunId,
      runKind: "planning",
      kind: "normalization_request_received",
      promptLength: promptText.length,
      promptPreview: summarizeProgressText(promptText, 240),
    });

    const result = await runSkillSubagent({
      ctx,
      promptText,
      forApply: false,
      state,
      debugRunId,
      debugLog: (record) => {
        void appendWorkflowDebugRecord(record);
      },
      ensureSubagentSession,
      getPiInvocation,
      resetSubagentProgress,
      beginWorkflowRun,
      pushSubagentEvent,
      setSubagentProgress,
      finalizeWorkflowRun,
      summarizeProgressCommand,
      summarizeProgressPath,
      summarizeProgressText,
      syncWorkflowChrome,
      prependSkillCommand: false,
      commandLabel: "model normalization",
      startEvent: "starting model normalization",
      finalizeOnComplete: false,
    });

    void appendWorkflowDebugRecord({
      runId: debugRunId,
      runKind: "planning",
      kind: "normalization_response_received",
      assistantPreview: summarizeProgressText(result.assistantText, 240),
      workflowState: result.workflowResult?.state ?? null,
      workflowStatus: result.workflowResult?.status ?? null,
      exitCode: result.exitCode,
      stderrPreview: summarizeProgressText(result.stderr, 240),
    });

    return {
      debugRunId,
      assistantText: result.assistantText,
      workflowResult: result.workflowResult,
      exitCode: result.exitCode,
      stderr: result.stderr,
    };
  };

  const buildPlanningFallbackPrompt = (
    promptText: string,
    directResult: {
      workflowResult: UpsertWorkflowResult | null;
      stdout: string;
      stderr: string;
      exitCode: number;
    },
  ) => {
    const directMessage = directResult.workflowResult?.message?.trim();
    const fallbackHints = [
      directMessage ? `Direct workflow message: ${summarizeProgressText(directMessage, 200)}` : "",
      directResult.stderr.trim() ? `Direct workflow stderr: ${summarizeProgressText(directResult.stderr, 200)}` : "",
    ].filter(Boolean);

    return `${promptText}

The direct envoy workflow parser could not produce a usable planning result from the request above, so you are helping only with ambiguity or normalization.
${fallbackHints.length > 0 ? `
Observed direct workflow output:
- ${fallbackHints.join("\n- ")}
` : ""}
Your job:
- clarify or normalize the request only as much as needed
- prefer a single normalized structured request
- if you read docs, only read these exact four files:
  - ${Array.from(DOC_READS).join("\n  - ")}
- do not reread the same doc if you already have enough information from it
- do not read any other files, including USAGE.md, ARCHITECTURE.md, scripts, tests, or the envoy template
- do not run bash or any other workflow command yourself; the extension will run the workflow after you return the normalized request
- output JSON only, with no prose before or after it
- the JSON must be a valid structured request payload accepted by run_workflow.py, for example a single request object or an object with a requests array
- use the documented field names exactly as defined by the allowed docs
- do not include markdown fences unless absolutely necessary
- the workflow output remains the source of truth for the final plan`;
  };

  const executeWorkflowPlanning = async (ctx: any, promptText: string) => {
    const directRunId = createWorkflowDebugRunId("planning");
    state.workflowUsageTotals.planningIsDirect = true;
    resetSubagentProgress();
    beginWorkflowRun(ctx, "python3 .pi/skills/envoy-route-cluster-upsert/scripts/run_workflow.py");
    setSubagentProgress(ctx, {
      phase: "tool",
      status: "Direct planning",
      detail: "trying workflow parser first · no model usage",
      bashCalls: 1,
    });
    pushSubagentEvent("direct planning attempt");
    void appendWorkflowDebugRecord({
      runId: directRunId,
      runKind: "planning",
      kind: "direct_planning_started",
      promptLength: promptText.length,
      promptPreview: summarizeProgressText(promptText, 240),
    });

    const directResult = await runDirectWorkflow({
      requestText: promptText,
      approve: false,
      debugRunId: directRunId,
      debugLog: (record) => {
        void appendWorkflowDebugRecord(record);
      },
    });

    if (!shouldFallbackToModelPlanning(directResult)) {
      void appendWorkflowDebugRecord({
        runId: directRunId,
        runKind: "planning",
        kind: "direct_planning_succeeded",
        workflowState: directResult.workflowResult?.state ?? null,
        workflowStatus: directResult.workflowResult?.status ?? null,
        nextStep: directResult.workflowResult?.next_step ?? null,
        exitCode: directResult.exitCode,
      });
      finalizeWorkflowRun(ctx, directResult.workflowResult);
      state.lastWorkflowRunKind = "planning";
      return directResult.workflowResult;
    }

    void appendWorkflowDebugRecord({
      runId: directRunId,
      runKind: "planning",
      kind: "direct_planning_fallback_to_model",
      workflowState: directResult.workflowResult?.state ?? null,
      workflowStatus: directResult.workflowResult?.status ?? null,
      errorKind: directResult.workflowResult?.error_kind ?? null,
      exitCode: directResult.exitCode,
      stderrPreview: summarizeProgressText(directResult.stderr, 240),
    });
    state.workflowUsageTotals.planningIsDirect = false;
    pushSubagentEvent("direct planning fallback to model normalization");

    const normalizationResult = await executeNormalizationSubagent(
      ctx,
      buildPlanningFallbackPrompt(promptText, directResult),
    );
    const normalizedPayload = parseNormalizedRequestPayload(normalizationResult.assistantText);
    if (!normalizedPayload) {
      const failureDetail = normalizationResult.workflowResult?.message
        || normalizationResult.stderr.trim()
        || normalizationResult.assistantText.trim()
        || "Fallback normalization did not return structured JSON.";
      void appendWorkflowDebugRecord({
        runId: normalizationResult.debugRunId,
        runKind: "planning",
        kind: "normalization_response_unparseable",
        assistantPreview: summarizeProgressText(normalizationResult.assistantText, 240),
        stderrPreview: summarizeProgressText(normalizationResult.stderr, 240),
      });
      state.workflowPhase = "ready";
      state.activeWorkflowRunKind = null;
      state.subagentProgress = {
        ...state.subagentProgress,
        phase: "failed",
        status: "Normalization failed",
        detail: summarizeProgressText(failureDetail, 120),
      };
      syncWorkflowChrome(ctx);
      throw new Error("Fallback normalization did not return structured JSON request output.");
    }

    const normalizedRequestText = stringifyNormalizedRequestPayload(normalizedPayload);
    void appendWorkflowDebugRecord({
      runId: normalizationResult.debugRunId,
      runKind: "planning",
      kind: "normalized_request_prepared",
      requestLength: normalizedRequestText.length,
      requestPreview: summarizeProgressText(normalizedRequestText, 240),
    });
    beginWorkflowRun(ctx, "python3 .pi/skills/envoy-route-cluster-upsert/scripts/run_workflow.py");
    setSubagentProgress(ctx, {
      phase: "tool",
      status: "Direct planning",
      detail: "running workflow from normalized request",
      bashCalls: state.subagentProgress.bashCalls + 1,
    });
    pushSubagentEvent("direct planning from normalized request");

    const normalizedWorkflowResult = await runDirectWorkflow({
      requestText: normalizedRequestText,
      approve: false,
      debugRunId: normalizationResult.debugRunId,
      debugLog: (record) => {
        void appendWorkflowDebugRecord(record);
      },
    });
    finalizeWorkflowRun(ctx, normalizedWorkflowResult.workflowResult);
    state.lastWorkflowRunKind = "planning";

    if (!normalizedWorkflowResult.workflowResult && normalizedWorkflowResult.exitCode !== 0) {
      throw new Error(
        normalizedWorkflowResult.stderr.trim()
          || normalizedWorkflowResult.stdout.trim()
          || "Envoy upsert planning failed after normalization.",
      );
    }

    return normalizedWorkflowResult.workflowResult;
  };

  const markBlocked = (ctx: any, notification: string, reason: string) => {
    state.blockedCount += 1;
    void appendWorkflowDebugRecord({
      kind: "guard_blocked_tooling",
      notification,
      reason,
      blockedCount: state.blockedCount,
    });
    ctx.ui.setStatus(GUARD_STATUS_KEY, `upsert-guard: active, blocked=${state.blockedCount}`);
    ctx.ui.notify(notification, "warning");
    return { block: true, reason };
  };

  const presentWorkflowProgressUi = async (ctx: any) => {
    if (!ctx.hasUI) {
      return;
    }

    await ctx.ui.custom<void>((_tui, theme, _kb, done) => ({
      render(width: number) {
        return buildProgressLines(
          theme,
          width,
          state.workflowPhase,
          state.subagentProgress,
          state.activeWorkflowRunKind,
          state.lastWorkflowRunKind,
          state.workflowUsageTotals,
          compactUsageFooterSummary,
        );
      },
      handleInput(data: string) {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
          done();
        }
      },
      invalidate() {},
    }));
  };

  const presentWorkflowUi = async (ctx: any, workflowResult: UpsertWorkflowResult, toolCallId?: string) => {
    if (!ctx.hasUI) {
      return;
    }
    if (toolCallId && state.workflowUiHandledByCallId.has(toolCallId)) {
      return;
    }

    const allowAction = shouldOfferApproval(workflowResult);
    if (allowAction && (state.approvalGranted || state.approvalPromptShown || state.approvalPromptActive)) {
      if (toolCallId) {
        state.workflowUiHandledByCallId.add(toolCallId);
      }
      return;
    }

    if (allowAction) {
      state.approvalPromptActive = true;
    }

    try {
      const choice = await requestWorkflowUi(
        ctx,
        workflowResult,
        allowAction,
        state.subagentProgress.usage,
        state.workflowUsageTotals,
        state.lastWorkflowRunKind,
        state.lastApplyAudit,
      );
      if (allowAction && choice) {
        await applyWorkflowChoice(ctx, choice, workflowResult);
      }
      if (toolCallId) {
        state.workflowUiHandledByCallId.add(toolCallId);
      }
    } finally {
      if (allowAction) {
        state.approvalPromptActive = false;
      }
    }
  };

  const handleWorkflowCompletion = async (ctx: any, workflowResult: UpsertWorkflowResult | null, toolCallId?: string) => {
    finalizeWorkflowRun(ctx, workflowResult);
    if (workflowResult) {
      await presentWorkflowUi(ctx, workflowResult, toolCallId);
    }
  };

  const applyWorkflowChoice = async (ctx: any, choice: ApprovalChoice, workflowResult: UpsertWorkflowResult) => {
    if (choice.action === "apply") {
      if (choice.selectedItemIndexes.length === 0) {
        ctx.ui.notify("Select at least one item before applying.", "warning");
        return;
      }
      let selectedRequestText: string;
      let selectedRequests: ReturnType<typeof buildSelectedRequestPayload>;
      try {
        selectedRequests = buildSelectedRequestPayload(workflowResult, choice.selectedItemIndexes);
        selectedRequestText = JSON.stringify(selectedRequests, null, 2);
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? `Couldn't prepare partial apply: ${error.message}` : `Couldn't prepare partial apply: ${String(error)}`,
          "error",
        );
        return;
      }
      state.approvalGranted = true;
      state.approvalDenied = false;
      state.approvalPromptShown = true;
      state.workflowUsageTotals.applyingIsDirect = true;
      state.lastApplyAudit = null;
      resetSubagentProgress();
      state.workflowPhase = "applying";
      state.latestWorkflowResult = null;
      state.activeWorkflowRunKind = "applying";
      state.lastWorkflowRunKind = "planning";
      setSubagentProgress(ctx, {
        phase: "tool",
        status: "Direct apply",
        detail: `${choice.selectedItemIndexes.length} selected item(s) · no model usage`,
      });
      pushSubagentEvent(`direct apply ${choice.selectedItemIndexes.length} selected item(s)`);
      ctx.ui.notify(`Approval captured. Applying ${choice.selectedItemIndexes.length} selected item(s).`, "success");

      try {
        const debugRunId = createWorkflowDebugRunId("applying");
        void appendWorkflowDebugRecord({
          runId: debugRunId,
          runKind: "applying",
          kind: "direct_apply_selected_items",
          selectedItemIndexes: choice.selectedItemIndexes,
          selectedCount: choice.selectedItemIndexes.length,
          requestCount: selectedRequests.length,
          requestPreview: summarizeProgressText(selectedRequestText, 240),
        });

        const directResult = await runDirectWorkflow({
          requestText: selectedRequestText,
          approve: true,
          debugRunId,
          debugLog: (record) => {
            void appendWorkflowDebugRecord(record);
          },
        });
        finalizeWorkflowRun(ctx, directResult.workflowResult);
        state.lastWorkflowRunKind = "applying";
        await cleanupSubagentSession();
        if (!directResult.workflowResult && directResult.exitCode !== 0) {
          throw new Error(directResult.stderr.trim() || directResult.stdout.trim() || "Envoy upsert apply failed.");
        }
        if (directResult.workflowResult) {
          state.lastApplyAudit = buildApplyAuditTrail(
            workflowResult,
            directResult.workflowResult,
            choice.selectedItemIndexes,
            selectedRequests.length,
          );
          try {
            state.lastApplyAudit = await persistApplyAuditTrail({
              audit: state.lastApplyAudit,
              selectedRequests,
              planResult: workflowResult,
              applyResult: directResult.workflowResult,
            });
          } catch (auditError) {
            ctx.ui.notify(
              auditError instanceof Error ? `Apply audit log write failed: ${auditError.message}` : `Apply audit log write failed: ${String(auditError)}`,
              "warning",
            );
          }
          const auditSummary = compactApplyAuditSummary(state.lastApplyAudit);
          if (auditSummary) {
            const logSuffix = state.lastApplyAudit.logPath ? ` · log ${state.lastApplyAudit.logPath}` : "";
            ctx.ui.notify(`Direct apply complete: ${auditSummary}${logSuffix}`, "success");
          }
          await presentWorkflowUi(ctx, directResult.workflowResult);
        }
      } catch (error) {
        void appendWorkflowDebugRecord({
          runKind: "applying",
          kind: "direct_apply_failed",
          error: error instanceof Error ? error.message : String(error),
        });
        state.workflowPhase = "ready";
        state.activeWorkflowRunKind = null;
        state.lastWorkflowRunKind = "applying";
          state.subagentProgress = {
          ...state.subagentProgress,
          phase: "failed",
          status: "Direct apply failed",
          detail: summarizeProgressText(error instanceof Error ? error.message : String(error), 120),
        };
        syncWorkflowChrome(ctx);
        ctx.ui.notify(
          error instanceof Error ? `Envoy upsert apply failed: ${error.message}` : `Envoy upsert apply failed: ${String(error)}`,
          "error",
        );
      }
      return;
    }

    state.approvalPromptShown = true;
    state.approvalDenied = true;
    void appendWorkflowDebugRecord({
      runKind: "planning",
      kind: "approval_cancelled",
    });
    ctx.ui.notify("Pending changes were not approved.", "warning");
    await cleanupSubagentSession();
  };

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension" || !ctx.hasUI) {
      return { action: "continue" };
    }
    if (!shouldGuard(event.text) || event.text.includes(SKILL_COMMAND)) {
      return { action: "continue" };
    }

    await resetWorkflowState(ctx, {
      enabled: true,
      attempted: true,
      approved: false,
    });
    void appendWorkflowDebugRecord({
      runKind: "planning",
      kind: "workflow_intercepted_input",
      promptLength: event.text.length,
      promptPreview: summarizeProgressText(event.text, 240),
    });
    ctx.ui.notify("Started the envoy upsert workflow.", "info");

    try {
      const workflowResult = await executeWorkflowPlanning(ctx, event.text);
      if (workflowResult) {
        await presentWorkflowUi(ctx, workflowResult);
        if (!shouldOfferApproval(workflowResult)) {
          await cleanupSubagentSession();
        }
      } else {
        ctx.ui.notify("Envoy upsert workflow completed without a parseable workflow result.", "warning");
      }
    } catch (error) {
      void appendWorkflowDebugRecord({
        runKind: "planning",
        kind: "workflow_planning_failed",
        error: error instanceof Error ? error.message : String(error),
      });
      state.workflowPhase = "ready";
      syncWorkflowChrome(ctx);
      ctx.ui.notify(
        error instanceof Error ? `Envoy upsert workflow failed: ${error.message}` : `Envoy upsert workflow failed: ${String(error)}`,
        "error",
      );
    }

    return { action: "handled" };
  });

  pi.registerTool({
    name: "bash",
    label: "bash",
    description: getOriginalBashTool(process.cwd()).description,
    parameters: getOriginalBashTool(process.cwd()).parameters,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return getOriginalBashTool(ctx.cwd).execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme, context) {
      const command = String(args.command ?? "");
      if (isWorkflowCommand(command)) {
        const phaseLabel = isApproveWorkflowCommand(command) ? "applying" : "planning";
        return new Text(
          `${theme.fg("toolTitle", theme.bold("envoy upsert workflow"))}${theme.fg("dim", ` · ${phaseLabel}`)}`,
          0,
          0,
        );
      }
      return getOriginalBashTool(context.cwd).renderCall?.(args, theme, context) ?? new Text(theme.fg("toolTitle", theme.bold(`$ ${command}`)), 0, 0);
    },
    renderResult(result, options, theme, context) {
      const command = String((context.args as { command?: string } | undefined)?.command ?? "");
      if (!isWorkflowCommand(command)) {
        return getOriginalBashTool(context.cwd).renderResult?.(result, options, theme, context) ?? new Text("", 0, 0);
      }

      if (options.isPartial) {
        return new Text(theme.fg("dim", "Workflow running in background…"), 0, 0);
      }

      const details = asDetailRecord(result.details);
      const workflowResult = (details.workflowResult as UpsertWorkflowResult | undefined) ?? parseWorkflowResult(result.content) ?? {};
      const lines = [theme.fg(shouldOfferApproval(workflowResult) ? "warning" : "success", compactWorkflowResultSummary(workflowResult))];
      const runUsageSummary = compactUsageFooterSummary(state.subagentProgress.usage);
      const totalUsageSummary = compactUsageFooterSummary(state.workflowUsageTotals.cumulative);
      if (workflowResult?.target_virtual_host) {
        lines.push(theme.fg("dim", `target: ${workflowResult.target_virtual_host}`));
      }
      if (runUsageSummary) {
        lines.push(theme.fg("dim", `last run: ${runUsageSummary}`));
      }
      if (totalUsageSummary && totalUsageSummary !== runUsageSummary) {
        lines.push(theme.fg("dim", `combined: ${totalUsageSummary}`));
      }
      lines.push(theme.fg("dim", "Open /upsert-workflow-ui for the full dashboard"));
      return new Text(lines.join(options.expanded ? "\n" : "  "), 0, 0);
    },
  });

  pi.registerCommand("upsert-workflow-ui", {
    description: "Open latest envoy-route-cluster-upsert workflow dashboard",
    handler: async (_args, ctx) => {
      if (!state.latestWorkflowResult) {
        if (state.workflowPhase === "planning" || state.workflowPhase === "applying") {
          await presentWorkflowProgressUi(ctx);
          return;
        }
        ctx.ui.notify("No envoy upsert workflow result available yet. Run the workflow first.", "warning");
        return;
      }
      await presentWorkflowUi(ctx, state.latestWorkflowResult);
    },
  });

  pi.registerCommand("upsert-workflow-debug-log", {
    description: "Show the envoy upsert workflow debug log path",
    handler: async (_args, ctx) => {
      ctx.ui.setEditorText(`tail -n 200 ${WORKFLOW_DEBUG_LOG_PATH}\n`);
      ctx.ui.notify(`Envoy upsert debug log: ${WORKFLOW_DEBUG_LOG_PATH}`, "info");
    },
  });

  pi.registerCommand("upsert-workflow-debug-last", {
    description: "Open a formatted summary of the latest envoy upsert debug run",
    handler: async (_args, ctx) => {
      try {
        const logText = await readFile(WORKFLOW_DEBUG_LOG_PATH, "utf-8");
        const latestRun = findLatestWorkflowDebugRun(parseWorkflowDebugLog(logText));
        if (!latestRun) {
          ctx.ui.notify(`No workflow debug runs found in ${WORKFLOW_DEBUG_LOG_PATH}`, "warning");
          return;
        }

        ctx.ui.setEditorText(formatWorkflowDebugRun(latestRun));
        ctx.ui.notify(`Opened latest envoy upsert debug run: ${latestRun.runId}`, "info");
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? `Couldn't open debug log: ${error.message}` : `Couldn't open debug log: ${String(error)}`,
          "error",
        );
      }
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const enabled = shouldGuard(event.prompt);
    await resetWorkflowState(ctx, {
      enabled,
      attempted: false,
      approved: hasExplicitApproval(event.prompt),
    });

    if (!enabled) {
      return undefined;
    }

    ctx.ui.setToolsExpanded(false);
    syncWorkflowChrome(ctx);
    return {
      message: {
        customType: "upsert-docs-only-guard",
        display: false,
        content:
          "For envoy-route-cluster-upsert routine use, only read SKILL.md, PLAYBOOK.md, JSON_CONTRACT.md, TROUBLESHOOTING.md, and envoy/docker/envoy.yaml.template. Do not inspect skill scripts/tests/extra docs. Invoke run_workflow.py directly when ready.",
      },
      systemPrompt:
        event.systemPrompt +
        "\n\nSpecial rule for envoy-route-cluster-upsert routine usage: only read these exact files: " +
        [...Array.from(DOC_READS), TEMPLATE_PATH].join(", ") +
        ". Do not read scripts, tests, USAGE.md, ARCHITECTURE.md, or list/search the skill directory. Do not read envoy/docker/envoy.yaml.template before the first run_workflow.py attempt. Do not run helper inspection commands like ls/find/rg/grep on the skill directory. If you need to act, invoke run_workflow.py directly with a normalized request. Never apply on the first pass. Do not use --approve unless the user explicitly approved in the current prompt. If the allowed docs are insufficient, say so instead of inspecting more files. After run_workflow.py --json returns upsert-workflow-v1 JSON, do not restate the result in detailed prose because the harness renders it. Only give a very short human response when needed: ask for approval if next_step is apply, otherwise keep it to one short sentence at most.",
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!state.guardEnabled) {
      return undefined;
    }

    if (state.approvalDenied) {
      return markBlocked(
        ctx,
        "upsert-guard blocked tooling after workflow was not approved",
        "Blocked: latest upsert workflow was not approved",
      );
    }

    if (event.toolName === "read") {
      const readPath = String(event.input.path ?? "");
      const allowedDocRead = DOC_READS.has(readPath);
      const allowedTemplateRead = readPath === TEMPLATE_PATH && state.workflowAttempted;
      if (!allowedDocRead && !allowedTemplateRead) {
        if (readPath === TEMPLATE_PATH && !state.workflowAttempted) {
          return markBlocked(
            ctx,
            "upsert-guard blocked template read before first workflow attempt",
            "Blocked template read before first run_workflow.py attempt",
          );
        }
        return markBlocked(ctx, `upsert-guard blocked read: ${readPath}`, `Blocked read outside allowlist: ${readPath}`);
      }
    }

    if (event.toolName === "bash") {
      const command = String(event.input.command ?? "");
      if (isWorkflowCommand(command)) {
        state.workflowCommandsByCallId.set(event.toolCallId, command);
        state.workflowUiHandledByCallId.delete(event.toolCallId);
      }
      if (isApproveWorkflowCommand(command) && !state.approvalGranted) {
        return markBlocked(
          ctx,
          "upsert-guard blocked apply without explicit approval",
          "Blocked --approve: explicit user approval is required in the current prompt",
        );
      }
      if (isAllowedWorkflowCommand(command)) {
        state.workflowAttempted = true;
        beginWorkflowRun(ctx, command);
        return undefined;
      }
      if (command.includes(SKILL_ROOT)) {
        return markBlocked(
          ctx,
          "upsert-guard blocked skill-dir bash inspection",
          "Blocked skill-dir bash inspection; use allowed docs or invoke run_workflow.py directly",
        );
      }
    }

    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!state.guardEnabled || event.toolName !== "bash") {
      return undefined;
    }

    const command = String((event.input as { command?: string } | undefined)?.command ?? "");
    if (!isWorkflowCommand(command)) {
      return undefined;
    }

    const workflowResult = parseWorkflowResult(event.content);
    await handleWorkflowCompletion(ctx, workflowResult, event.toolCallId);
    if (!workflowResult) {
      return undefined;
    }

    return {
      content: [],
      details: buildWorkflowToolDetails(event.details, workflowResult),
    };
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    if (!state.guardEnabled || event.toolName !== "bash") {
      return undefined;
    }

    const command = state.workflowCommandsByCallId.get(event.toolCallId) ?? "";
    state.workflowCommandsByCallId.delete(event.toolCallId);
    if (!isWorkflowCommand(command)) {
      return undefined;
    }

    const workflowResult = parseWorkflowResult(event.result);
    await handleWorkflowCompletion(ctx, workflowResult, event.toolCallId);
    return undefined;
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (state.guardEnabled) {
      syncWorkflowChrome(ctx);
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await resetWorkflowState(ctx, {
      enabled: false,
      attempted: false,
      approved: false,
    });
  });
}
