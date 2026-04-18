import {
  collectSelectableWorkflowItems,
  summarizeSelectableWorkflowItem,
} from "./selection.ts";
import type { ApplyAuditTrail, UpsertWorkflowResult } from "./types.ts";

function collectWarningCount(result: UpsertWorkflowResult | null | undefined): number {
  return (result?.warnings ?? []).length;
}

function buildApplyAuditTrail(
  planResult: UpsertWorkflowResult,
  applyResult: UpsertWorkflowResult | null | undefined,
  selectedItemIndexes: number[],
  requestCount: number,
): ApplyAuditTrail {
  const uniqueIndexes = [...new Set(selectedItemIndexes)].sort((left, right) => left - right);
  const selectableByIndex = new Map(
    collectSelectableWorkflowItems(planResult).map((item) => [item.itemIndex, item] as const),
  );
  const selectedItems = uniqueIndexes
    .map((itemIndex) => selectableByIndex.get(itemIndex))
    .filter((item): item is NonNullable<typeof item> => !!item);

  return {
    mode: "direct",
    timestamp: new Date().toISOString(),
    logPath: null,
    selectedItemIndexes: uniqueIndexes,
    selectedCount: uniqueIndexes.length,
    requestCount,
    selectedSummaries: selectedItems.map((item) => summarizeSelectableWorkflowItem(item)),
    selectedContexts: [...new Set(selectedItems.map((item) => item.context))],
    routeCount: applyResult?.summary?.add_routes ?? applyResult?.additions?.routes?.length ?? 0,
    clusterCount: applyResult?.summary?.add_clusters ?? applyResult?.additions?.clusters?.length ?? 0,
    warningCount: collectWarningCount(applyResult),
    targetVirtualHost: applyResult?.target_virtual_host ?? planResult.target_virtual_host ?? null,
    resultState: applyResult?.state ?? applyResult?.status ?? "UNKNOWN",
  };
}

function compactApplyAuditSummary(audit: ApplyAuditTrail | null | undefined): string {
  if (!audit) {
    return "";
  }

  const parts = [
    `${audit.selectedCount} selected`,
    `${audit.requestCount} request${audit.requestCount === 1 ? "" : "s"}`,
    `${audit.routeCount} route${audit.routeCount === 1 ? "" : "s"}`,
    `${audit.clusterCount} cluster${audit.clusterCount === 1 ? "" : "s"}`,
  ];
  if (audit.targetVirtualHost) {
    parts.push(`target ${audit.targetVirtualHost}`);
  }
  if (audit.warningCount > 0) {
    parts.push(`${audit.warningCount} warning${audit.warningCount === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export {
  buildApplyAuditTrail,
  compactApplyAuditSummary,
};
