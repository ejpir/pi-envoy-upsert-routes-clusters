import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { APPLY_AUDIT_LOG_PATH } from "./constants.ts";
import type { ReconstructedRequest } from "./selection.ts";
import type { ApplyAuditTrail, UpsertWorkflowResult } from "./types.ts";

type PersistApplyAuditOptions = {
  audit: ApplyAuditTrail;
  selectedRequests: ReconstructedRequest[];
  planResult: UpsertWorkflowResult;
  applyResult: UpsertWorkflowResult | null | undefined;
  logPath?: string;
};

async function persistApplyAuditTrail(options: PersistApplyAuditOptions): Promise<ApplyAuditTrail> {
  const logPath = options.logPath ?? APPLY_AUDIT_LOG_PATH;
  await mkdir(path.dirname(logPath), { recursive: true });

  const record = {
    timestamp: options.audit.timestamp,
    mode: options.audit.mode,
    targetVirtualHost: options.audit.targetVirtualHost,
    resultState: options.audit.resultState,
    selection: {
      itemIndexes: options.audit.selectedItemIndexes,
      selectedCount: options.audit.selectedCount,
      requestCount: options.audit.requestCount,
      selectedContexts: options.audit.selectedContexts,
      selectedSummaries: options.audit.selectedSummaries,
      requests: options.selectedRequests,
    },
    result: {
      routeCount: options.audit.routeCount,
      clusterCount: options.audit.clusterCount,
      warningCount: options.audit.warningCount,
      state: options.applyResult?.state ?? null,
      status: options.applyResult?.status ?? null,
      nextStep: options.applyResult?.next_step ?? null,
      targetVirtualHost: options.applyResult?.target_virtual_host ?? null,
      summary: options.applyResult?.summary ?? null,
    },
    plan: {
      state: options.planResult.state ?? null,
      status: options.planResult.status ?? null,
      nextStep: options.planResult.next_step ?? null,
      targetVirtualHost: options.planResult.target_virtual_host ?? null,
      summary: options.planResult.summary ?? null,
    },
  };

  await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf-8");
  return {
    ...options.audit,
    logPath,
  };
}

export { persistApplyAuditTrail };
