import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import readline from "node:readline";

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

function parseWorkflowDebugRecord(line: string): WorkflowDebugRecord | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as WorkflowDebugRecord;
    }
  } catch {
    // ignore malformed lines
  }
  return null;
}

function parseWorkflowDebugLog(text: string): WorkflowDebugRecord[] {
  const records: WorkflowDebugRecord[] = [];
  for (const line of text.split("\n")) {
    const parsed = parseWorkflowDebugRecord(line);
    if (parsed) {
      records.push(parsed);
    }
  }
  return records;
}

function findLatestWorkflowDebugRun(records: WorkflowDebugRecord[]): WorkflowDebugRun | null {
  let latestRunId: string | null = null;
  let latestRunKind: string | null = null;
  const latestRunRecords: WorkflowDebugRecord[] = [];

  for (const record of records) {
    const runId = typeof record.runId === "string" && record.runId ? record.runId : null;
    if (!runId) {
      continue;
    }

    if (latestRunId === null || runId !== latestRunId) {
      latestRunId = runId;
      latestRunKind = typeof record.runKind === "string" ? record.runKind : null;
      latestRunRecords.length = 0;
    }

    if (runId === latestRunId) {
      latestRunRecords.push(record);
      if (!latestRunKind && typeof record.runKind === "string") {
        latestRunKind = record.runKind;
      }
    }
  }

  if (!latestRunId) {
    return null;
  }

  return {
    runId: latestRunId,
    runKind: latestRunKind,
    records: [...latestRunRecords],
  };
}

async function findLatestWorkflowDebugRunFromFile(logPath: string): Promise<WorkflowDebugRun | null> {
  const fileStats = await stat(logPath);
  if (fileStats.size === 0) {
    return null;
  }

  const stream = createReadStream(logPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let latestRunId: string | null = null;
  let latestRunKind: string | null = null;
  const latestRunRecords: WorkflowDebugRecord[] = [];

  try {
    for await (const line of rl) {
      const record = parseWorkflowDebugRecord(line);
      if (!record) {
        continue;
      }

      const runId = typeof record.runId === "string" && record.runId ? record.runId : null;
      if (!runId) {
        continue;
      }

      if (latestRunId === null || runId !== latestRunId) {
        latestRunId = runId;
        latestRunKind = typeof record.runKind === "string" ? record.runKind : null;
        latestRunRecords.length = 0;
      }

      latestRunRecords.push(record);
      if (!latestRunKind && typeof record.runKind === "string") {
        latestRunKind = record.runKind;
      }
    }
  } finally {
    rl.close();
    stream.close();
  }

  if (!latestRunId) {
    return null;
  }

  return {
    runId: latestRunId,
    runKind: latestRunKind,
    records: [...latestRunRecords],
  };
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
  findLatestWorkflowDebugRunFromFile,
  formatWorkflowDebugRun,
  parseWorkflowDebugLog,
};
export type { WorkflowDebugRecord, WorkflowDebugRun };
