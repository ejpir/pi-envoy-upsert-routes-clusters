type WorkflowDebugRecord = {
  timestamp?: string;
  runId?: string | null;
  runKind?: string | null;
  kind?: string | null;
  eventType?: string | null;
  toolName?: string | null;
  workflowState?: string | null;
  workflowStatus?: string | null;
  nextStep?: string | null;
  exitCode?: number | null;
  blockedCount?: number | null;
  line?: string | null;
  chunk?: string | null;
  [key: string]: unknown;
};

type WorkflowDebugRun = {
  runId: string;
  runKind: string | null;
  records: WorkflowDebugRecord[];
};

function parseWorkflowDebugLog(text: string): WorkflowDebugRecord[] {
  const records: WorkflowDebugRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push(parsed as WorkflowDebugRecord);
      }
    } catch {
      // ignore malformed lines
    }
  }
  return records;
}

function findLatestWorkflowDebugRun(records: WorkflowDebugRecord[]): WorkflowDebugRun | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const runId = records[index]?.runId;
    if (typeof runId !== "string" || !runId) {
      continue;
    }

    const runRecords = records.filter((record) => record.runId === runId);
    const runKind = runRecords.find((record) => typeof record.runKind === "string")?.runKind ?? null;
    return {
      runId,
      runKind,
      records: runRecords,
    };
  }

  return null;
}

function summarizeValue(value: unknown, width = 120): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) {
    return "";
  }
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= width) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, width - 3))}...`;
}

function formatWorkflowDebugRun(run: WorkflowDebugRun): string {
  const toolStarts = run.records.filter((record) => record.kind === "subagent_event" && record.eventType === "tool_execution_start");
  const bashStarts = toolStarts.filter((record) => record.toolName === "bash").length;
  const readStarts = toolStarts.filter((record) => record.toolName === "read").length;
  const workflowDetections = run.records.filter((record) => record.kind === "workflow_result_detected");
  const exits = run.records.filter((record) => record.kind === "subagent_exit" || record.kind === "direct_workflow_finish");

  const lines = [
    `Envoy upsert debug run`,
    `runId: ${run.runId}`,
    `runKind: ${run.runKind ?? "(unknown)"}`,
    `records: ${run.records.length}`,
    `tool starts: read=${readStarts} bash=${bashStarts}`,
    `workflow detections: ${workflowDetections.length}`,
    `exit records: ${exits.length}`,
    "",
    "Timeline:",
  ];

  run.records.forEach((record, index) => {
    const parts = [
      `${String(index + 1).padStart(2, "0")}.`,
      record.timestamp ?? "(no time)",
      record.kind ?? "(no kind)",
    ];

    if (record.eventType) parts.push(`event=${record.eventType}`);
    if (record.toolName) parts.push(`tool=${record.toolName}`);
    if (record.workflowState) parts.push(`state=${record.workflowState}`);
    if (record.workflowStatus) parts.push(`status=${record.workflowStatus}`);
    if (record.nextStep) parts.push(`next=${record.nextStep}`);
    if (typeof record.exitCode === "number") parts.push(`exit=${record.exitCode}`);
    if (typeof record.blockedCount === "number") parts.push(`blocked=${record.blockedCount}`);

    const preview =
      summarizeValue(record.promptPreview) ||
      summarizeValue(record.requestPreview) ||
      summarizeValue(record.stderrPreview) ||
      summarizeValue(record.stdoutPreview) ||
      summarizeValue(record.error) ||
      summarizeValue(record.notification) ||
      summarizeValue(record.reason) ||
      summarizeValue(record.line) ||
      summarizeValue(record.chunk);

    if (preview) {
      parts.push(`:: ${preview}`);
    }

    lines.push(parts.join("  "));
  });

  return `${lines.join("\n")}\n`;
}

export {
  findLatestWorkflowDebugRun,
  formatWorkflowDebugRun,
  parseWorkflowDebugLog,
};
export type { WorkflowDebugRecord, WorkflowDebugRun };
