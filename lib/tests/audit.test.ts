import { describe, expect, test } from "bun:test";
import { buildApplyAuditTrail, compactApplyAuditSummary } from "../audit.ts";

describe("audit.ts", () => {
  test("builds apply audit trail from selected plan items and apply result", () => {
    const planResult = {
      target_virtual_host: "dtap_apps",
      check: {
        payload: {
          items: [
            {
              context: "/app/demo",
              flavor: "http",
              match_mode: "path",
              cluster: "demo_cluster",
              cluster_status: "apply",
              routes: [{ status: "apply", add: true }],
            },
            {
              context: "/app/other",
              flavor: "s3",
              match_mode: "path+prefix",
              cluster: "other_cluster",
              cluster_status: "skip",
              routes: [{ status: "apply", add: true }],
            },
          ],
        },
      },
    };
    const applyResult = {
      state: "APPLIED",
      target_virtual_host: "dtap_apps",
      summary: {
        add_routes: 2,
        add_clusters: 1,
      },
      warnings: [{ message: "Heads up" }],
    };

    const audit = buildApplyAuditTrail(planResult, applyResult, [1], 1);

    expect(audit.mode).toBe("direct");
    expect(audit.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(audit.logPath).toBeNull();
    expect(audit.selectedCount).toBe(1);
    expect(audit.requestCount).toBe(1);
    expect(audit.selectedContexts).toEqual(["/app/other"]);
    expect(audit.selectedSummaries).toEqual(["/app/other • [s3/path+prefix] • 1 route(s)"]);
    expect(audit.routeCount).toBe(2);
    expect(audit.clusterCount).toBe(1);
    expect(audit.warningCount).toBe(1);
    expect(compactApplyAuditSummary(audit)).toContain("1 selected");
    expect(compactApplyAuditSummary(audit)).toContain("target dtap_apps");
  });
});
