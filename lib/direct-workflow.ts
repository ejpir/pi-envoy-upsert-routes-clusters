import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bindAbortSignal } from "./abort.ts";
import { ROOT, WORKFLOW_SCRIPT_PATH } from "./constants.ts";
import { parseWorkflowResult } from "./workflow.ts";
import type { UpsertWorkflowResult } from "./types.ts";

type DirectWorkflowOptions = {
  requestText: string;
  approve: boolean;
  signal?: AbortSignal;
  workflowScriptPath?: string;
  debugRunId?: string;
  debugLog?: (record: Record<string, unknown>) => void;
};

function summarizeDebugText(text: string, width = 240): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= width) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, width - 3))}...`;
}

async function runDirectWorkflow(options: DirectWorkflowOptions): Promise<{
  workflowResult: UpsertWorkflowResult | null;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-upsert-direct-"));
  const requestFile = path.join(dir, "request.json");
  const workflowScriptPath = options.workflowScriptPath ?? WORKFLOW_SCRIPT_PATH;

  try {
    options.debugLog?.({
      runId: options.debugRunId ?? null,
      runKind: options.approve ? "applying" : "planning",
      kind: "direct_workflow_start",
      approve: options.approve,
      workflowScriptPath,
      requestLength: options.requestText.length,
      requestPreview: summarizeDebugText(options.requestText),
    });

    await writeFile(requestFile, options.requestText, "utf-8");

    const args = [
      workflowScriptPath,
      "--request-file",
      requestFile,
      "--json",
    ];
    if (options.approve) {
      args.push("--approve");
    }

    const { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
      const proc = spawn("python3", args, {
        cwd: ROOT,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const cleanupAbort = bindAbortSignal(options.signal, proc, (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });

      proc.stdout.on("data", (chunk: unknown) => {
        stdout += String(chunk);
      });
      proc.stderr.on("data", (chunk: unknown) => {
        stderr += String(chunk);
      });
      proc.on("error", (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupAbort();
        reject(error);
      });
      proc.on("close", (code: number | null) => {
        if (settled) {
          cleanupAbort();
          return;
        }
        settled = true;
        cleanupAbort();
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });
    });

    const workflowResult = parseWorkflowResult(stdout.trim());
    options.debugLog?.({
      runId: options.debugRunId ?? null,
      runKind: options.approve ? "applying" : "planning",
      kind: "direct_workflow_finish",
      approve: options.approve,
      exitCode,
      workflowState: workflowResult?.state ?? null,
      workflowStatus: workflowResult?.status ?? null,
      nextStep: workflowResult?.next_step ?? null,
      stdoutPreview: summarizeDebugText(stdout),
      stderrPreview: summarizeDebugText(stderr),
    });

    return {
      workflowResult,
      stdout,
      stderr,
      exitCode,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export { runDirectWorkflow };
