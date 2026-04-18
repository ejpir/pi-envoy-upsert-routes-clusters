import { describe, expect, test } from "bun:test";
import {
  findLatestWorkflowDebugRun,
  formatWorkflowDebugRun,
  parseWorkflowDebugLog,
} from "../debug-log-view.ts";

describe("debug-log-view.ts", () => {
  test("parses jsonl and finds the latest run by runId", () => {
    const records = parseWorkflowDebugLog([
      JSON.stringify({ timestamp: "2026-04-18T10:00:00Z", runId: "planning-a", runKind: "planning", kind: "subagent_spawn" }),
      "not-json",
      JSON.stringify({ timestamp: "2026-04-18T10:00:01Z", runId: "planning-a", runKind: "planning", kind: "subagent_exit", exitCode: 0 }),
      JSON.stringify({ timestamp: "2026-04-18T10:01:00Z", runId: "planning-b", runKind: "planning", kind: "subagent_spawn" }),
      JSON.stringify({ timestamp: "2026-04-18T10:01:01Z", runId: "planning-b", runKind: "planning", kind: "workflow_result_detected", workflowState: "WAITING_APPROVAL" }),
    ].join("\n"));

    expect(records).toHaveLength(4);

    const latestRun = findLatestWorkflowDebugRun(records);
    expect(latestRun?.runId).toBe("planning-b");
    expect(latestRun?.records).toHaveLength(2);
  });

  test("formats a readable timeline for the latest run", () => {
    const latestRun = findLatestWorkflowDebugRun(parseWorkflowDebugLog([
      JSON.stringify({ timestamp: "2026-04-18T10:01:00Z", runId: "planning-b", runKind: "planning", kind: "subagent_spawn", promptPreview: "demo prompt" }),
      JSON.stringify({ timestamp: "2026-04-18T10:01:01Z", runId: "planning-b", runKind: "planning", kind: "subagent_event", eventType: "tool_execution_start", toolName: "read", line: '{"type":"tool_execution_start"}' }),
      JSON.stringify({ timestamp: "2026-04-18T10:01:02Z", runId: "planning-b", runKind: "planning", kind: "subagent_event", eventType: "tool_execution_start", toolName: "bash", line: '{"type":"tool_execution_start"}' }),
      JSON.stringify({ timestamp: "2026-04-18T10:01:03Z", runId: "planning-b", runKind: "planning", kind: "workflow_result_detected", workflowState: "WAITING_APPROVAL", nextStep: "apply" }),
      JSON.stringify({ timestamp: "2026-04-18T10:01:04Z", runId: "planning-b", runKind: "planning", kind: "subagent_exit", exitCode: 0, workflowState: "WAITING_APPROVAL" }),
    ].join("\n")));

    expect(latestRun).not.toBeNull();
    const output = formatWorkflowDebugRun(latestRun!);
    expect(output).toContain("runId: planning-b");
    expect(output).toContain("tool starts: read=1 bash=1");
    expect(output).toContain("workflow detections: 1");
    expect(output).toContain("state=WAITING_APPROVAL");
    expect(output).toContain("exit=0");
  });
});
