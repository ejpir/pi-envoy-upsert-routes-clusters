import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendWorkflowDebugRecord,
  createWorkflowDebugRunId,
  flushWorkflowDebugLogWrites,
} from "../debug-log.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await flushWorkflowDebugLogWrites();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("debug-log.ts", () => {
  test("creates run ids and appends jsonl records", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "upsert-debug-log-test-"));
    tempDirs.push(dir);
    const logPath = path.join(dir, "debug.jsonl");
    const runId = createWorkflowDebugRunId("planning");

    expect(runId.startsWith("planning-")).toBe(true);

    await appendWorkflowDebugRecord(
      {
        runId,
        runKind: "planning",
        kind: "subagent_spawn",
        promptPreview: "demo request",
      },
      logPath,
    );
    await flushWorkflowDebugLogWrites();

    const lines = (await readFile(logPath, "utf-8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record.runId).toBe(runId);
    expect(record.runKind).toBe("planning");
    expect(record.kind).toBe("subagent_spawn");
    expect(record.promptPreview).toBe("demo request");
    expect(typeof record.timestamp).toBe("string");
  });
});
