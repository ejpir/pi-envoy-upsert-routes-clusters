import { describe, expect, test } from "bun:test";
import { createExtensionState } from "../state.ts";
import { parseSubagentEventLine, processSubagentEvent } from "../subagent-events.ts";

describe("subagent-events.ts", () => {
  test("parses json lines and ignores invalid input", () => {
    expect(parseSubagentEventLine("")).toBeNull();
    expect(parseSubagentEventLine("not-json")).toBeNull();
    expect(parseSubagentEventLine('{"type":"message_start"}')).toEqual({ type: "message_start" });
  });

  test("tracks read progress and assistant usage", () => {
    const state = createExtensionState();
    state.workflowPhase = "planning";
    const tracking = { workflowResult: null, lastAssistantText: "" };
    const events: string[] = [];
    let finalizedWorkflowResult: unknown = null;

    processSubagentEvent({
      event: {
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "/tmp/skill/SKILL.md" },
      },
      state,
      tracking,
      beginWorkflowRun: () => {},
      finalizeWorkflowRun: (workflowResult) => {
        finalizedWorkflowResult = workflowResult;
      },
      pushSubagentEvent: (message) => events.push(message),
      setSubagentProgress: (update) => {
        state.subagentProgress = { ...state.subagentProgress, ...update };
      },
      summarizeProgressCommand: (command) => command,
      summarizeProgressPath: (filePath) => filePath,
      summarizeProgressText: (text) => text,
    });

    expect(state.subagentProgress.reads).toBe(1);
    expect(events[0]).toBe("read /tmp/skill/SKILL.md");

    processSubagentEvent({
      event: {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                schema_version: "upsert-workflow-v1",
                state: "WAITING_APPROVAL",
                next_step: "apply",
                summary: { add_routes: 1, add_clusters: 1 },
              }),
            },
          ],
          usage: {
            input: 1000,
            output: 200,
            cacheRead: 300,
            cost: { total: 0.01 },
          },
        },
      },
      state,
      tracking,
      beginWorkflowRun: () => {},
      finalizeWorkflowRun: (workflowResult) => {
        finalizedWorkflowResult = workflowResult;
      },
      pushSubagentEvent: (message) => events.push(message),
      setSubagentProgress: (update) => {
        state.subagentProgress = { ...state.subagentProgress, ...update };
      },
      summarizeProgressCommand: (command) => command,
      summarizeProgressPath: (filePath) => filePath,
      summarizeProgressText: (text) => text,
    });

    expect(state.subagentProgress.usage.turns).toBe(1);
    expect(state.subagentProgress.usage.input).toBe(1000);
    expect(state.subagentProgress.usage.output).toBe(200);
    expect(state.subagentProgress.usage.cacheRead).toBe(300);
    expect(tracking.workflowResult?.state).toBe("WAITING_APPROVAL");
    expect(tracking.lastAssistantText).toContain("upsert-workflow-v1");
    expect(finalizedWorkflowResult).toBeNull();
  });
});
