import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { persistApplyAuditTrail } from "../audit-log.ts";
import { buildApplyAuditTrail } from "../audit.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("audit-log.ts", () => {
  test("persists direct apply audit records as jsonl", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "upsert-audit-log-test-"));
    tempDirs.push(dir);
    const logPath = path.join(dir, "audit.jsonl");

    const planResult = {
      state: "WAITING_APPROVAL",
      next_step: "apply",
      target_virtual_host: "dtap_apps",
      summary: { add_routes: 1, add_clusters: 1 },
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
          ],
        },
      },
    };
    const applyResult = {
      state: "APPLIED",
      target_virtual_host: "dtap_apps",
      summary: { add_routes: 1, add_clusters: 1 },
      warnings: [],
    };
    const audit = buildApplyAuditTrail(planResult, applyResult, [0], 1);

    const persisted = await persistApplyAuditTrail({
      audit,
      selectedRequests: [
        {
          context: "/app/demo",
          flavor: "http",
          match: "path",
          forward_host: "demo.internal",
          cluster_name: "demo_cluster",
        },
      ],
      planResult,
      applyResult,
      logPath,
    });

    expect(persisted.logPath).toBe(logPath);

    const lines = (await readFile(logPath, "utf-8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record.mode).toBe("direct");
    expect(record.targetVirtualHost).toBe("dtap_apps");
    expect(record.selection.selectedContexts).toEqual(["/app/demo"]);
    expect(record.selection.requests[0].forward_host).toBe("demo.internal");
    expect(record.result.routeCount).toBe(1);
    expect(record.plan.state).toBe("WAITING_APPROVAL");
  });
});
