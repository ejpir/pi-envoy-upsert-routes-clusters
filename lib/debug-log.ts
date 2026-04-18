import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { WORKFLOW_DEBUG_LOG_PATH } from "./constants.ts";

type WorkflowDebugRecord = {
  timestamp?: string;
  [key: string]: unknown;
};

let writeQueue: Promise<void> = Promise.resolve();

function createWorkflowDebugRunId(runKind: string): string {
  return `${runKind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendWorkflowDebugRecord(record: WorkflowDebugRecord, logPath = WORKFLOW_DEBUG_LOG_PATH): Promise<void> {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(logPath), { recursive: true });
      await appendFile(
        logPath,
        `${JSON.stringify({
          timestamp: record.timestamp ?? new Date().toISOString(),
          ...record,
        })}\n`,
        "utf-8",
      );
    });

  return writeQueue;
}

async function flushWorkflowDebugLogWrites(): Promise<void> {
  await writeQueue.catch(() => undefined);
}

export {
  appendWorkflowDebugRecord,
  createWorkflowDebugRunId,
  flushWorkflowDebugLogWrites,
};
