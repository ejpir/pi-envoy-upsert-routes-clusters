import { spawn } from "node:child_process";
import { ROOT, SKILL_COMMAND, SUBAGENT_FALLBACK_EXTENSION_PATH, WORKFLOW_SCRIPT_PATH } from "./constants.ts";
import {
  cloneUsageStats,
  mergeUsageStats,
} from "./usage.ts";
import { parseSubagentEventLine, processSubagentEvent } from "./subagent-events.ts";
import {
  parseWorkflowResult,
} from "./workflow.ts";
import type { ExtensionState } from "./state.ts";
import type {
  SubagentProgress,
  UpsertWorkflowResult,
  WorkflowRunKind,
} from "./types.ts";

type RunSkillSubagentOptions = {
  ctx: any;
  promptText: string;
  forApply: boolean;
  state: ExtensionState;
  debugRunId: string;
  debugLog: (record: Record<string, unknown>) => void;
  ensureSubagentSession: () => Promise<string>;
  getPiInvocation: () => { command: string; args: string[] };
  resetSubagentProgress: () => void;
  beginWorkflowRun: (ctx: any, command: string) => void;
  pushSubagentEvent: (message: string) => void;
  setSubagentProgress: (ctx: any, update: Partial<SubagentProgress>) => void;
  finalizeWorkflowRun: (ctx: any, workflowResult: UpsertWorkflowResult | null) => void;
  summarizeProgressCommand: (command: string) => string;
  summarizeProgressPath: (path: string) => string;
  summarizeProgressText: (text: string, width?: number) => string;
  syncWorkflowChrome: (ctx: any) => void;
  prependSkillCommand?: boolean;
  commandLabel?: string;
  startEvent?: string;
  finalizeOnComplete?: boolean;
};

type RunSkillSubagentResult = {
  workflowResult: UpsertWorkflowResult | null;
  assistantText: string;
  exitCode: number;
  stderr: string;
};

function summarizeDebugText(text: string, width = 240): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= width) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, width - 3))}...`;
}

async function runSkillSubagent(options: RunSkillSubagentOptions): Promise<RunSkillSubagentResult> {
  const {
    ctx,
    promptText,
    forApply,
    state,
    debugRunId,
    debugLog,
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
    prependSkillCommand = true,
    commandLabel,
    startEvent,
    finalizeOnComplete = true,
  } = options;

  const runKind: WorkflowRunKind = forApply ? "applying" : "planning";
  const invocation = getPiInvocation();
  const sessionFile = await ensureSubagentSession();
  const fullPrompt = prependSkillCommand && !forApply ? `${SKILL_COMMAND}\n\n${promptText}` : promptText;
  const args = [
    ...invocation.args,
    "--mode",
    "json",
    "-p",
    "--session",
    sessionFile,
    "--no-extensions",
    "--no-tools",
    "-e",
    SUBAGENT_FALLBACK_EXTENSION_PATH,
  ];

  if (ctx.model?.provider) {
    args.push("--provider", String(ctx.model.provider));
  }
  if (ctx.model?.id) {
    args.push("--model", String(ctx.model.id));
  }
  args.push(fullPrompt);

  debugLog({
    runId: debugRunId,
    runKind,
    kind: "subagent_spawn",
    forApply,
    sessionFile,
    promptLength: promptText.length,
    promptPreview: summarizeDebugText(promptText),
    command: invocation.command,
    args,
  });

  resetSubagentProgress();
  beginWorkflowRun(
    ctx,
    commandLabel
      ?? (forApply
        ? `python3 ${WORKFLOW_SCRIPT_PATH} --approve`
        : `python3 ${WORKFLOW_SCRIPT_PATH}`),
  );
  pushSubagentEvent(startEvent ?? (forApply ? "Applying pending upsert plan" : "Starting upsert planning run"));

  let stderr = "";
  let buffer = "";
  const tracking = {
    workflowResult: null as UpsertWorkflowResult | null,
    lastAssistantText: "",
  };

  const exitCode = await new Promise<number>((resolve, reject) => {
    const proc = spawn(invocation.command, args, {
      cwd: ROOT,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const processLine = (line: string) => {
      const event = parseSubagentEventLine(line);
      if (!event) {
        debugLog({
          runId: debugRunId,
          runKind,
          kind: "subagent_stdout_unparsed",
          line,
        });
        return;
      }

      debugLog({
        runId: debugRunId,
        runKind,
        kind: "subagent_event",
        eventType: event.type ?? null,
        toolName: event.toolName ?? null,
        line,
      });

      const previousWorkflowState = tracking.workflowResult?.state ?? null;
      processSubagentEvent({
        event,
        state,
        tracking,
        beginWorkflowRun: (command) => beginWorkflowRun(ctx, command),
        finalizeWorkflowRun: (workflowResult) => finalizeWorkflowRun(ctx, workflowResult),
        pushSubagentEvent,
        setSubagentProgress: (update) => setSubagentProgress(ctx, update),
        summarizeProgressCommand,
        summarizeProgressPath,
        summarizeProgressText,
      });

      const nextWorkflowState = tracking.workflowResult?.state ?? null;
      if (nextWorkflowState && nextWorkflowState !== previousWorkflowState) {
        debugLog({
          runId: debugRunId,
          runKind,
          kind: "workflow_result_detected",
          workflowState: tracking.workflowResult?.state ?? null,
          workflowStatus: tracking.workflowResult?.status ?? null,
          nextStep: tracking.workflowResult?.next_step ?? null,
          sourceEventType: event.type ?? null,
        });
      }
    };

    proc.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    });
    proc.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      debugLog({
        runId: debugRunId,
        runKind,
        kind: "subagent_stderr",
        chunk: text,
      });
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (buffer.trim()) {
        processLine(buffer);
      }
      resolve(code ?? 1);
    });
  });

  if (!tracking.workflowResult && tracking.lastAssistantText) {
    tracking.workflowResult = parseWorkflowResult(tracking.lastAssistantText);
    if (tracking.workflowResult) {
      debugLog({
        runId: debugRunId,
        runKind,
        kind: "workflow_result_detected",
        workflowState: tracking.workflowResult.state ?? null,
        workflowStatus: tracking.workflowResult.status ?? null,
        nextStep: tracking.workflowResult.next_step ?? null,
        sourceEventType: "assistant_fallback_parse",
      });
    }
  }
  if (finalizeOnComplete) {
    finalizeWorkflowRun(ctx, tracking.workflowResult);
  }

  const completedUsage = cloneUsageStats(state.subagentProgress.usage);
  mergeUsageStats(state.workflowUsageTotals[runKind], completedUsage);
  mergeUsageStats(state.workflowUsageTotals.cumulative, completedUsage);
  state.lastWorkflowRunKind = runKind;
  syncWorkflowChrome(ctx);

  debugLog({
    runId: debugRunId,
    runKind,
    kind: "subagent_exit",
    exitCode,
    workflowState: tracking.workflowResult?.state ?? null,
    workflowStatus: tracking.workflowResult?.status ?? null,
    nextStep: tracking.workflowResult?.next_step ?? null,
    reads: state.subagentProgress.reads,
    bashCalls: state.subagentProgress.bashCalls,
    usage: completedUsage,
    stderrPreview: summarizeDebugText(stderr),
  });

  if (!tracking.workflowResult && exitCode !== 0) {
    state.subagentProgress = {
      ...state.subagentProgress,
      phase: "failed",
      status: "Workflow failed",
      detail: summarizeProgressText(stderr.trim() || tracking.lastAssistantText || "Envoy upsert subagent failed.", 120),
    };
    syncWorkflowChrome(ctx);
    throw new Error(stderr.trim() || tracking.lastAssistantText || "Envoy upsert subagent failed.");
  }

  return {
    workflowResult: tracking.workflowResult,
    assistantText: tracking.lastAssistantText,
    exitCode,
    stderr,
  };
}

export { runSkillSubagent };
export type { RunSkillSubagentResult };
