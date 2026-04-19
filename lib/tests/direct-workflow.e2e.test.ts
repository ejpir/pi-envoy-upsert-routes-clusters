import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runDirectWorkflow } from "../direct-workflow.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createWorkflowStub(scriptBody: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "upsert-direct-workflow-"));
  tempDirs.push(dir);
  const scriptPath = path.join(dir, "workflow_stub.py");
  await writeFile(scriptPath, scriptBody, "utf-8");
  return scriptPath;
}

describe("direct-workflow.e2e", () => {
  test("runs a workflow script end-to-end and parses JSON output", async () => {
    const scriptPath = await createWorkflowStub(`#!/usr/bin/env python3
import argparse
import json

parser = argparse.ArgumentParser()
parser.add_argument("--request-file", required=True)
parser.add_argument("--json", action="store_true")
parser.add_argument("--approve", action="store_true")
args = parser.parse_args()

with open(args.request_file, "r", encoding="utf-8") as f:
    payload = f.read().strip()

print(json.dumps({
    "schema_version": "upsert-workflow-v1",
    "state": "APPLIED" if args.approve else "WAITING_APPROVAL",
    "status": "applied" if args.approve else "waiting_approval",
    "next_step": None if args.approve else "apply",
    "target_virtual_host": "dtap_apps",
    "message": payload,
    "summary": {"add_routes": 1, "add_clusters": 1}
}))
`);

    const result = await runDirectWorkflow({
      requestText: '{"demo":true}',
      approve: false,
      workflowScriptPath: scriptPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.workflowResult?.state).toBe("WAITING_APPROVAL");
    expect(result.workflowResult?.target_virtual_host).toBe("dtap_apps");
    expect(result.workflowResult?.summary?.add_routes).toBe(1);
  });

  test("aborts a long-running workflow script via AbortSignal", async () => {
    const scriptPath = await createWorkflowStub(`#!/usr/bin/env python3
import argparse
import json
import time

parser = argparse.ArgumentParser()
parser.add_argument("--request-file", required=True)
parser.add_argument("--json", action="store_true")
parser.add_argument("--approve", action="store_true")
args = parser.parse_args()

time.sleep(10)
print(json.dumps({
    "schema_version": "upsert-workflow-v1",
    "state": "WAITING_APPROVAL",
    "status": "waiting_approval",
    "next_step": "apply"
}))
`);

    const controller = new AbortController();
    const promise = runDirectWorkflow({
      requestText: '{"sleep":true}',
      approve: false,
      signal: controller.signal,
      workflowScriptPath: scriptPath,
    });

    setTimeout(() => controller.abort(), 100);

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
