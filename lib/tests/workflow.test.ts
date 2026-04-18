import { describe, expect, test } from "bun:test";
import { WORKFLOW_SCRIPT_PATH } from "../constants.ts";
import {
  isAllowedWorkflowCommand,
  isApproveWorkflowCommand,
  parseWorkflowResult,
  shouldFallbackToModelPlanning,
  shouldOfferApproval,
} from "../workflow.ts";

describe("workflow.ts", () => {
  test("parses structured workflow JSON", () => {
    const result = parseWorkflowResult(JSON.stringify({
      schema_version: "upsert-workflow-v1",
      state: "WAITING_APPROVAL",
      next_step: "apply",
      target_virtual_host: "dtap_apps",
      summary: {
        add_routes: 2,
        add_clusters: 1,
      },
    }));

    expect(result).not.toBeNull();
    expect(result?.target_virtual_host).toBe("dtap_apps");
    expect(result?.summary?.add_routes).toBe(2);
    expect(shouldOfferApproval(result!)).toBe(true);
  });

  test("infers waiting approval from human message fallback", () => {
    const result = parseWorkflowResult(
      "Planned changes are ready in context dtap_apps, please approve to add 2 routes and 1 cluster. 1 warning found. Next: apply.",
    );

    expect(result).not.toBeNull();
    expect(result?.schema_version).toBe("upsert-workflow-v1");
    expect(result?.state).toBe("WAITING_APPROVAL");
    expect(result?.next_step).toBe("apply");
    expect(result?.summary?.add_routes).toBe(2);
    expect(result?.summary?.add_clusters).toBe(1);
    expect(result?.summary?.warnings).toBe(1);
    expect(result?.target_virtual_host).toBe("dtap_apps");
  });

  test("allows only direct workflow command without inspection helpers", () => {
    expect(isAllowedWorkflowCommand(`python3 ${WORKFLOW_SCRIPT_PATH} --json`)).toBe(true);
    expect(isAllowedWorkflowCommand(`python3 ${WORKFLOW_SCRIPT_PATH} --help`)).toBe(false);
    expect(isAllowedWorkflowCommand(`python3 ${WORKFLOW_SCRIPT_PATH} && rg foo ${WORKFLOW_SCRIPT_PATH}`)).toBe(false);
  });

  test("detects apply command", () => {
    expect(isApproveWorkflowCommand(`python3 ${WORKFLOW_SCRIPT_PATH} --approve`)).toBe(true);
    expect(isApproveWorkflowCommand(`python3 ${WORKFLOW_SCRIPT_PATH}`)).toBe(false);
  });

  test("falls back to model planning for parse-like workflow errors", () => {
    expect(shouldFallbackToModelPlanning({ workflowResult: null, exitCode: 1 })).toBe(true);
    expect(shouldFallbackToModelPlanning({
      workflowResult: {
        schema_version: "upsert-workflow-v1",
        state: "ERROR",
        status: "error",
        error_kind: "manual_review_required",
        message: "Could not parse the request into proxy contexts.",
      },
      exitCode: 2,
    })).toBe(true);
  });

  test("does not fall back to model planning for non-input workflow errors", () => {
    expect(shouldFallbackToModelPlanning({
      workflowResult: {
        schema_version: "upsert-workflow-v1",
        state: "ERROR",
        status: "error",
        error_kind: "runtime_error",
        message: "No virtual host matched regex ^dtap_.",
      },
      exitCode: 1,
    })).toBe(false);
    expect(shouldFallbackToModelPlanning({
      workflowResult: {
        schema_version: "upsert-workflow-v1",
        state: "WAITING_APPROVAL",
        status: "waiting_approval",
        next_step: "apply",
      },
      exitCode: 2,
    })).toBe(false);
  });
});
