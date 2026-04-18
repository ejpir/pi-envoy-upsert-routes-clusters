import { addUsageStats, compactUsageSummary } from "./usage.ts";
import {
  compactWorkflowResultSummary,
  extractTextPayload,
  isApproveWorkflowCommand,
  isWorkflowCommand,
  parseWorkflowResult,
} from "./workflow.ts";
import type { ExtensionState } from "./state.ts";
import type {
  SubagentProgress,
  UpsertWorkflowResult,
} from "./types.ts";

export type SubagentEventTracking = {
  workflowResult: UpsertWorkflowResult | null;
  lastAssistantText: string;
};

type ProcessSubagentEventOptions = {
  event: any;
  state: ExtensionState;
  tracking: SubagentEventTracking;
  beginWorkflowRun: (command: string) => void;
  finalizeWorkflowRun: (workflowResult: UpsertWorkflowResult | null) => void;
  pushSubagentEvent: (message: string) => void;
  setSubagentProgress: (update: Partial<SubagentProgress>) => void;
  summarizeProgressCommand: (command: string) => string;
  summarizeProgressPath: (path: string) => string;
  summarizeProgressText: (text: string, width?: number) => string;
};

function parseSubagentEventLine(line: string): any | null {
  if (!line.trim()) {
    return null;
  }

  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function processSubagentEvent(options: ProcessSubagentEventOptions): void {
  const {
    event,
    state,
    tracking,
    beginWorkflowRun,
    finalizeWorkflowRun,
    pushSubagentEvent,
    setSubagentProgress,
    summarizeProgressCommand,
    summarizeProgressPath,
    summarizeProgressText,
  } = options;

  if (event.type === "message_start" && event.message?.role === "assistant") {
    setSubagentProgress({
      phase: "thinking",
      status: state.workflowPhase === "applying" ? "Applying workflow" : "Planning workflow",
      detail: "thinking",
    });
    return;
  }

  if (event.type === "tool_execution_start") {
    if (event.toolName === "read") {
      const filePath = String(event.args?.path ?? "");
      const detail = summarizeProgressPath(filePath);
      state.subagentProgress.reads += 1;
      pushSubagentEvent(`read ${detail}`);
      setSubagentProgress({
        phase: "tool",
        status: "Reading allowed docs",
        detail,
        reads: state.subagentProgress.reads,
      });
      return;
    }

    if (event.toolName === "bash") {
      const command = String(event.args?.command ?? "");
      const detail = summarizeProgressCommand(command);
      state.subagentProgress.bashCalls += 1;
      pushSubagentEvent(`bash ${detail}`);
      if (isWorkflowCommand(command)) {
        beginWorkflowRun(command);
        pushSubagentEvent(`${isApproveWorkflowCommand(command) ? "apply" : "plan"} ${detail}`);
      } else {
        setSubagentProgress({
          phase: "tool",
          status: "Running bash",
          detail,
          bashCalls: state.subagentProgress.bashCalls,
        });
      }
      return;
    }

    setSubagentProgress({
      phase: "tool",
      status: `Running ${String(event.toolName ?? "tool")}`,
      detail: "",
    });
    return;
  }

  if (event.type === "tool_execution_end") {
    if (event.toolName === "bash") {
      const maybeResult = parseWorkflowResult(event.result);
      if (maybeResult) {
        tracking.workflowResult = maybeResult;
        pushSubagentEvent(compactWorkflowResultSummary(maybeResult));
        finalizeWorkflowRun(maybeResult);
        return;
      }
    }
    setSubagentProgress({
      phase: "thinking",
      status: state.workflowPhase === "applying" ? "Applying workflow" : "Planning workflow",
      detail: "processing result",
    });
    return;
  }

  if (event.type === "message_update" && event.message?.role === "assistant") {
    const delta = String(event.assistantMessageEvent?.delta ?? "").trim();
    if (delta) {
      setSubagentProgress({
        phase: "responding",
        status: "Assistant response",
        detail: summarizeProgressText(delta, 72),
      });
    }
    return;
  }

  if (event.type === "message_end" && event.message?.role === "assistant") {
    state.subagentProgress.usage.turns += 1;
    addUsageStats(state.subagentProgress.usage, event.message?.usage);

    const text = extractTextPayload(event.message).trim();
    const usageSummary = compactUsageSummary(state.subagentProgress.usage);
    if (text) {
      tracking.lastAssistantText = text;
      const summary = summarizeProgressText(text.split("\n")[0] ?? text, 88);
      pushSubagentEvent(`assistant ${summary}${usageSummary ? ` · ${usageSummary}` : ""}`);
      setSubagentProgress({
        phase: "responding",
        status: "Assistant response",
        detail: usageSummary ? `${summary} · ${usageSummary}` : summary,
        usage: { ...state.subagentProgress.usage },
      });
      const inferred = parseWorkflowResult(text);
      if (inferred) {
        tracking.workflowResult = inferred;
      }
    } else {
      setSubagentProgress({
        usage: { ...state.subagentProgress.usage },
      });
    }
  }
}

export { parseSubagentEventLine, processSubagentEvent };
