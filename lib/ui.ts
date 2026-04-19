import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import type { GuardContext, GuardCustomUiController } from "./guard-context.ts";
import {
  WORKFLOW_DASHBOARD_WIDTH,
  WORKFLOW_DEBUG_LOG_PATH,
  WORKFLOW_PROGRESS_HEIGHT,
  WORKFLOW_UI_HEIGHT,
  WORKFLOW_UI_STICKY_HEADER_COUNT,
} from "./constants.ts";
import {
  collectSelectableWorkflowItems,
  summarizeSelectableWorkflowItem,
  type SelectableWorkflowItem,
} from "./selection.ts";
import { formatPreviewRouteLine } from "./preview-env-tags.ts";
import { truncate, summarizeProgressCommand, summarizeProgressPath, summarizeProgressText } from "./progress.ts";
import {
  formatTokenCount,
  hasUsageStats,
  totalUsageTokens,
} from "./usage.ts";
import type {
  ApprovalChoice,
  ApplyAuditTrail,
  DecisionRow,
  SubagentProgress,
  ThemeLike,
  UpsertPlanItem,
  UpsertRouteDecision,
  UpsertWorkflowResult,
  UsageStats,
  WorkflowRunKind,
  WorkflowUsageTotals,
} from "./types.ts";

function themed(theme: ThemeLike | undefined, color: string, text: string): string {
  if (!theme?.fg || typeof theme.fg !== "function") {
    return text;
  }
  return theme.fg(color, text);
}

function summarizeStatus(status: string | undefined): string {
  if (!status) return "UNKNOWN";
  if (status === "apply") return "APPLY";
  if (status === "skip_exists") return "EXISTS";
  if (status === "skip_overlap") return "OVERLAP";
  return status.toUpperCase();
}

function summarizeMatch(route: UpsertRouteDecision): string {
  const kind = route.match_kind ?? "(unknown kind)";
  const value = route.match_value ?? "(unknown value)";
  return `${kind}:${value}`;
}

function statusColor(status: string | undefined): string {
  if (status === "apply") return "success";
  if (status === "skip_exists") return "warning";
  if (status === "skip_overlap") return "warning";
  if (status === "blocked") return "error";
  return "text";
}

function statusBadge(theme: ThemeLike | undefined, status: string | undefined): string {
  return themed(theme, statusColor(status), ` ${summarizeStatus(status)} `);
}

function section(theme: ThemeLike | undefined, title: string, width: number): string {
  const barWidth = Math.max(0, width - title.length - 4);
  return `${themed(theme, "accent", ` ${title} `)}${themed(theme, "dim", "─".repeat(barWidth))}`;
}

function formatListItem(text: string, width: number): string {
  return truncate(text, width);
}

function collectDecisionRows(result: UpsertWorkflowResult): DecisionRow[] {
  const rows: DecisionRow[] = [];
  const items = result.check?.payload?.items ?? [];
  for (const item of items) {
    const context = item.context ?? "(no context)";
    for (const route of item.routes ?? []) {
      const rawMatch = summarizeMatch(route);
      const status = route.status ?? "UNKNOWN";
      const cluster = route.cluster ?? "(no cluster)";
      const disposition = route.assessment?.disposition ? ` (${route.assessment.disposition})` : "";
      rows.push({
        status,
        line: `${summarizeStatus(status)} | ${context} | ${rawMatch} -> ${cluster}${disposition}`,
      });
    }
  }
  return rows;
}

function appendUsageBlock(
  lines: string[],
  theme: ThemeLike | undefined,
  label: string,
  usage: UsageStats | null | undefined,
  directNote?: string,
): void {
  if (!hasUsageStats(usage)) {
    lines.push(`${themed(theme, "accent", `${label}: `)}${themed(theme, "dim", directNote ?? "(not reported)")}`);
    return;
  }

  lines.push(`${themed(theme, "accent", `${label}: `)}${themed(theme, "text", `${usage?.turns ?? 0} turn(s)`)}`);
  lines.push(
    `  ${themed(theme, "muted", `in ${formatTokenCount(usage?.input ?? 0)}  out ${formatTokenCount(usage?.output ?? 0)}  total ${formatTokenCount(totalUsageTokens(usage))}`)}`,
  );

  const extraParts: string[] = [];
  if ((usage?.cacheRead ?? 0) > 0) extraParts.push(`cache-read ${formatTokenCount(usage!.cacheRead)}`);
  if ((usage?.cacheWrite ?? 0) > 0) extraParts.push(`cache-write ${formatTokenCount(usage!.cacheWrite)}`);
  if ((usage?.contextTokens ?? 0) > 0) extraParts.push(`ctx ${formatTokenCount(usage!.contextTokens)}`);
  if ((usage?.cost ?? 0) > 0) extraParts.push(`$${usage!.cost.toFixed(4)}`);
  if (extraParts.length > 0) {
    lines.push(`  ${themed(theme, "muted", extraParts.join("  "))}`);
  }
}

function appendSelectionBlock(
  lines: string[],
  theme: ThemeLike | undefined,
  selectableItems: SelectableWorkflowItem[],
  selectedItemIndexes: Set<number>,
  selectionCursor: number,
): void {
  lines.push(section(theme, "Selection", WORKFLOW_DASHBOARD_WIDTH));
  if (selectableItems.length === 0) {
    lines.push(`  ${themed(theme, "dim", "No individually selectable additions were detected")}`);
    return;
  }

  lines.push(
    `${themed(theme, "accent", "Selected items: ")}${themed(theme, "text", `${Array.from(selectedItemIndexes).length}/${selectableItems.length}`)}`,
  );
  selectableItems.forEach((item, index) => {
    const pointer = index === selectionCursor ? ">" : " ";
    const checked = selectedItemIndexes.has(item.itemIndex) ? "[x]" : "[ ]";
    const detail = formatListItem(summarizeSelectableWorkflowItem(item), WORKFLOW_DASHBOARD_WIDTH - 10);
    lines.push(`  ${pointer} ${checked} ${detail}`);
  });
}

function appendSelectionDetailBlock(
  lines: string[],
  result: UpsertWorkflowResult,
  theme: ThemeLike | undefined,
  selectableItems: SelectableWorkflowItem[],
  selectionCursor: number,
): void {
  lines.push(section(theme, "Selection detail", WORKFLOW_DASHBOARD_WIDTH));
  if (selectableItems.length === 0) {
    lines.push(`  ${themed(theme, "dim", "Move through selection items to inspect route and cluster details")}`);
    return;
  }

  const selected = selectableItems[selectionCursor];
  const item = selected ? result.check?.payload?.items?.[selected.itemIndex] as UpsertPlanItem | undefined : undefined;
  if (!selected || !item) {
    lines.push(`  ${themed(theme, "dim", "No selected item details available")}`);
    return;
  }

  const matchingRoutes = (result.additions?.routes ?? []).filter((route) => {
    const sameContext = route.context === item.context;
    const sameCluster = !item.cluster || !route.cluster || route.cluster === item.cluster;
    return sameContext && sameCluster;
  });
  const matchingClusters = (result.additions?.clusters ?? []).filter((cluster) => cluster.name === item.cluster);

  lines.push(`  ${themed(theme, "accent", "Context: ")}${themed(theme, "text", item.context ?? "(none)")}`);
  lines.push(`  ${themed(theme, "accent", "Flavor: ")}${themed(theme, "text", `${item.flavor ?? "(unknown)"} / ${item.match_mode ?? "(unknown)"}`)}`);
  lines.push(`  ${themed(theme, "accent", "Cluster: ")}${themed(theme, "text", item.cluster ?? "(unknown)")}`);
  if (item.cluster_host) {
    lines.push(`  ${themed(theme, "accent", "Forward host: ")}${themed(theme, "text", item.cluster_host)}`);
  }
  if ((item.warnings ?? []).length > 0) {
    lines.push(`  ${themed(theme, "accent", "Item warnings: ")}${themed(theme, "warning", String((item.warnings ?? []).length))}`);
  }

  if (matchingRoutes.length === 0 && matchingClusters.length === 0) {
    lines.push(`  ${themed(theme, "dim", "No concrete additions available for preview")}`);
    return;
  }

  lines.push(`  ${themed(theme, "accent", "Preview:")}`);
  matchingRoutes.slice(0, 4).forEach((route) => {
    lines.push(`    ${themed(theme, "success", formatListItem(formatPreviewRouteLine(route), WORKFLOW_DASHBOARD_WIDTH - 8))}`);
  });
  if (matchingRoutes.length > 4) {
    lines.push(`    ${themed(theme, "dim", `+ ${matchingRoutes.length - 4} more route addition(s)`)}`);
  }

  matchingClusters.slice(0, 2).forEach((cluster) => {
    const diffLine = `+ cluster ${cluster.name ?? "(unnamed)"} -> ${cluster.host ?? "(no host)"}`;
    lines.push(`    ${themed(theme, "success", formatListItem(diffLine, WORKFLOW_DASHBOARD_WIDTH - 8))}`);
  });
  if (matchingClusters.length > 2) {
    lines.push(`    ${themed(theme, "dim", `+ ${matchingClusters.length - 2} more cluster addition(s)`)}`);
  }
}

function buildWorkflowDetailsLines(
  result: UpsertWorkflowResult,
  theme: ThemeLike | undefined,
  allowAction: boolean,
  lastRunUsage: UsageStats | null | undefined,
  usageTotals: WorkflowUsageTotals,
  lastRunKind: WorkflowRunKind | null,
  lastApplyAudit: ApplyAuditTrail | null | undefined,
  selectableItems: SelectableWorkflowItem[],
  selectedItemIndexes: Set<number>,
  selectionCursor: number,
): string[] {
  const lines: string[] = [];
  const width = WORKFLOW_DASHBOARD_WIDTH;
  const summary = result.summary ?? {};
  const routeAdditions = result.additions?.routes ?? [];
  const clusterAdditions = result.additions?.clusters ?? [];
  const routeCount = summary.add_routes ?? routeAdditions.length;
  const clusterCount = summary.add_clusters ?? clusterAdditions.length;
  const state = result.state ?? "(unknown)";
  const next = result.next_step ?? "(none)";
  const decisions = collectDecisionRows(result);
  const warnings = (result.warnings ?? []).map((warning) => {
    if (typeof warning === "string") return warning;
    return warning?.message ?? "(warning with no message)";
  });

  const stageColor = next === "apply" || state === "WAITING_APPROVAL" ? "warning" : "accent";
  lines.push(themed(theme, "accent", "Envoy upsert workflow"));
  lines.push(section(theme, "Summary", width));
  lines.push(`${themed(theme, "accent", "State: ")}${themed(theme, stageColor, state)}  ${themed(theme, "accent", "Next: ")}${themed(theme, stageColor, next)}`);
  lines.push(`${themed(theme, "accent", "Target host: ")}${themed(theme, "text", result.target_virtual_host ?? "(not detected)")}`);
  lines.push(`${themed(theme, "accent", "Routes: ")}${themed(theme, "success", String(routeCount))}  ${themed(theme, "accent", "Clusters: ")}${themed(theme, "success", String(clusterCount))}`);
  lines.push(
    `${themed(theme, "accent", "Skipped exists: ")}${themed(theme, "warning", String(summary.skipped_route_exists ?? 0))}  ${themed(theme, "accent", "Skipped overlaps: ")}${themed(theme, "warning", String(summary.skipped_route_overlap ?? 0))}`,
  );
  if (result.message) {
    lines.push(`${themed(theme, "accent", "Message: ")}${themed(theme, "muted", truncate(result.message, width - 10))}`);
  }

  lines.push(section(theme, "Usage", width));
  appendUsageBlock(
    lines,
    theme,
    lastRunKind ? `Last run (${lastRunKind})` : "Last run",
    lastRunUsage,
    lastRunKind === "planning" && usageTotals.planningIsDirect
      ? "direct planning (no model usage)"
      : (lastRunKind === "applying" && usageTotals.applyingIsDirect ? "direct apply (no model usage)" : undefined),
  );
  appendUsageBlock(lines, theme, "Planning total", usageTotals.planning, usageTotals.planningIsDirect ? "direct planning (no model usage)" : undefined);
  appendUsageBlock(lines, theme, "Applying total", usageTotals.applying, usageTotals.applyingIsDirect ? "direct apply (no model usage)" : undefined);
  appendUsageBlock(lines, theme, "Combined total", usageTotals.cumulative);

  if (lastApplyAudit) {
    lines.push(section(theme, "Last apply audit", width));
    lines.push(`${themed(theme, "accent", "Mode: ")}${themed(theme, "text", "direct filtered apply")}`);
    lines.push(`${themed(theme, "accent", "Timestamp: ")}${themed(theme, "text", lastApplyAudit.timestamp)}`);
    lines.push(`${themed(theme, "accent", "Selected: ")}${themed(theme, "text", `${lastApplyAudit.selectedCount} item(s) / ${lastApplyAudit.requestCount} request(s)`)}`);
    lines.push(`${themed(theme, "accent", "Applied result: ")}${themed(theme, "text", `${lastApplyAudit.routeCount} route(s), ${lastApplyAudit.clusterCount} cluster(s)`)}`);
    lines.push(`${themed(theme, "accent", "Target host: ")}${themed(theme, "text", lastApplyAudit.targetVirtualHost ?? "(not reported)")}`);
    if (lastApplyAudit.logPath) {
      lines.push(`${themed(theme, "accent", "Audit log: ")}${themed(theme, "muted", formatListItem(lastApplyAudit.logPath, width - 14))}`);
    }
    if (lastApplyAudit.warningCount > 0) {
      lines.push(`${themed(theme, "accent", "Warnings: ")}${themed(theme, "warning", String(lastApplyAudit.warningCount))}`);
    }
    if (lastApplyAudit.selectedSummaries.length > 0) {
      lines.push(`${themed(theme, "accent", "Selected items:")}`);
      lastApplyAudit.selectedSummaries.slice(0, 6).forEach((summary, index) => {
        lines.push(`  ${String(index + 1).padStart(2, " ")}. ${themed(theme, "muted", formatListItem(summary, width - 8))}`);
      });
      if (lastApplyAudit.selectedSummaries.length > 6) {
        lines.push(`  + ${lastApplyAudit.selectedSummaries.length - 6} more selected item(s)`);
      }
    }
  }

  if (allowAction) {
    appendSelectionBlock(lines, theme, selectableItems, selectedItemIndexes, selectionCursor);
    appendSelectionDetailBlock(lines, result, theme, selectableItems, selectionCursor);
  }

  lines.push(section(theme, "Decisions", width));
  lines.push(`${themed(theme, "accent", "Route decisions")} (${decisions.length})`);
  if (decisions.length === 0) {
    lines.push(`  ${themed(theme, "dim", "No route decisions emitted")}`);
  } else {
    decisions.slice(0, 10).forEach((row, index) => {
      const detail = formatListItem(row.line, Math.max(20, width - 8));
      lines.push(`  ${String(index + 1).padStart(2, " ")}. ${statusBadge(theme, row.status)} ${themed(theme, "muted", detail)}`);
    });
    if (decisions.length > 10) {
      lines.push(`  + ${decisions.length - 10} more route decision(s)`);
    }
  }

  lines.push(section(theme, "Planned additions", width));
  lines.push(`${themed(theme, "accent", "Planned route additions")} (${routeAdditions.length})`);
  if (routeAdditions.length === 0) {
    lines.push(`  ${themed(theme, "dim", "(none)")}`);
  } else {
    routeAdditions.slice(0, 10).forEach((route, index) => {
      const detail = formatListItem(`${route.context ?? "(no context)"} • ${summarizeMatch(route)} -> ${route.cluster ?? "(none)"}`, width - 12);
      lines.push(`  ${String(index + 1).padStart(2, " ")}. ${themed(theme, "success", detail)}`);
    });
    if (routeAdditions.length > 10) {
      lines.push(`  + ${routeAdditions.length - 10} more route addition(s)`);
    }
  }

  lines.push(`${themed(theme, "accent", "Planned cluster additions")} (${clusterAdditions.length})`);
  if (clusterAdditions.length === 0) {
    lines.push(`  ${themed(theme, "dim", "(none)")}`);
  } else {
    clusterAdditions.slice(0, 10).forEach((cluster, index) => {
      const detail = formatListItem(`${cluster.name ?? "(no name)"} -> ${cluster.host ?? "(no host)"}`, width - 12);
      lines.push(`  ${String(index + 1).padStart(2, " ")}. ${themed(theme, "success", detail)}`);
    });
    if (clusterAdditions.length > 10) {
      lines.push(`  + ${clusterAdditions.length - 10} more cluster addition(s)`);
    }
  }

  lines.push(section(theme, "Diagnostics", width));
  lines.push(`${themed(theme, "accent", "Debug log: ")}${themed(theme, "muted", formatListItem(WORKFLOW_DEBUG_LOG_PATH, width - 13))}`);
  lines.push(`${themed(theme, "accent", "Warnings")} (${warnings.length})`);
  if (warnings.length === 0) {
    lines.push(`  ${themed(theme, "dim", "(none)")}`);
  } else {
    warnings.slice(0, 8).forEach((warning, index) => {
      lines.push(`  ${String(index + 1).padStart(2, " ")}. ${themed(theme, "warning", formatListItem(warning, width - 8))}`);
    });
    if (warnings.length > 8) {
      lines.push(`  + ${warnings.length - 8} more warning(s)`);
    }
  }

  lines.push(section(theme, "Action", width));
  lines.push(themed(theme, "dim", allowAction ? "Use a/c keys in this workflow UI to choose apply or cancel. The highlighted item shows a drill-down preview above." : "No pending approval required for this result."));
  return lines;
}

function requestWorkflowUi(
  ctx: GuardContext,
  workflowResult: UpsertWorkflowResult,
  forApproval: boolean,
  lastRunUsage: UsageStats | null | undefined,
  usageTotals: WorkflowUsageTotals,
  lastRunKind: WorkflowRunKind | null,
  lastApplyAudit?: ApplyAuditTrail | null,
): Promise<ApprovalChoice | undefined> {
  return ctx.ui.custom<ApprovalChoice | undefined>((tui: GuardCustomUiController, theme, _kb, done) => {
    let scrollOffset = 0;
    const selectableItems = collectSelectableWorkflowItems(workflowResult);
    const selectedItemIndexes = new Set(selectableItems.map((item) => item.itemIndex));
    let selectionCursor = 0;

    return {
      render(width: number) {
        const lines = buildWorkflowDetailsLines(
          workflowResult,
          theme,
          forApproval,
          lastRunUsage,
          usageTotals,
          lastRunKind,
          lastApplyAudit,
          selectableItems,
          selectedItemIndexes,
          selectionCursor,
        );
        const visibleLineCount = WORKFLOW_UI_HEIGHT;
        const stickyHeaderCount = Math.min(WORKFLOW_UI_STICKY_HEADER_COUNT, lines.length);
        const bodyLines = lines.slice(stickyHeaderCount);
        const bodyVisibleCount = Math.max(8, visibleLineCount - stickyHeaderCount);
        const maxOffset = Math.max(0, bodyLines.length - bodyVisibleCount);
        scrollOffset = Math.max(0, Math.min(scrollOffset, maxOffset));

        const header = lines.slice(0, stickyHeaderCount).map((line) => truncateToWidth(line, width));
        const divider = [truncateToWidth(theme.fg("dim", "─".repeat(width)), width)];
        const body = bodyLines
          .slice(scrollOffset, scrollOffset + bodyVisibleCount)
          .map((line) => truncateToWidth(line, width));

        const windowed = [...header, ...divider, ...body];
        const actionHint = forApproval
          ? theme.fg("dim", "Actions: space/x toggle, j/k move, + all, - none, a apply, c cancel • ↑↓/pgup/pgdn scroll")
          : theme.fg("dim", "Scroll: ↑↓ / pgup pgdn • esc close");

        if (bodyLines.length > bodyVisibleCount) {
          const footer = theme.fg(
            "dim",
            `${actionHint} • ${scrollOffset + 1}-${Math.min(scrollOffset + bodyVisibleCount, bodyLines.length)}/${bodyLines.length}`,
          );
          if (windowed.length >= visibleLineCount) {
            windowed[visibleLineCount - 1] = truncateToWidth(footer, width);
          } else {
            windowed.push(truncateToWidth(footer, width));
          }
        } else if (windowed.length < visibleLineCount) {
          windowed.push(theme.fg("dim", actionHint));
        }

        return windowed.slice(0, visibleLineCount);
      },
      handleInput(data: string) {
        if (forApproval) {
          if ((matchesKey(data, " ") || matchesKey(data, "x")) && selectableItems.length > 0) {
            const currentItem = selectableItems[selectionCursor];
            if (currentItem) {
              if (selectedItemIndexes.has(currentItem.itemIndex)) {
                selectedItemIndexes.delete(currentItem.itemIndex);
              } else {
                selectedItemIndexes.add(currentItem.itemIndex);
              }
              tui.requestRender();
            }
            return;
          }
          if (matchesKey(data, "j") && selectableItems.length > 0) {
            selectionCursor = Math.min(selectableItems.length - 1, selectionCursor + 1);
            tui.requestRender();
            return;
          }
          if (matchesKey(data, "k") && selectableItems.length > 0) {
            selectionCursor = Math.max(0, selectionCursor - 1);
            tui.requestRender();
            return;
          }
          if (matchesKey(data, "+") && selectableItems.length > 0) {
            selectedItemIndexes.clear();
            selectableItems.forEach((item) => selectedItemIndexes.add(item.itemIndex));
            tui.requestRender();
            return;
          }
          if (matchesKey(data, "-") && selectableItems.length > 0) {
            selectedItemIndexes.clear();
            tui.requestRender();
            return;
          }
          if (
            matchesKey(data, "a") ||
            matchesKey(data, Key.enter) ||
            data === "\r" ||
            data === "\n"
          ) {
            done({ action: "apply", selectedItemIndexes: Array.from(selectedItemIndexes).sort((left, right) => left - right) });
            return;
          }
          if (matchesKey(data, "c") || matchesKey(data, Key.escape)) {
            done({ action: "cancel" });
            return;
          }
        } else if (matchesKey(data, Key.escape)) {
          done(undefined);
          return;
        }

        if (matchesKey(data, Key.up)) {
          scrollOffset = Math.max(0, scrollOffset - 1);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.down)) {
          scrollOffset += 1;
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.pageUp)) {
          scrollOffset = Math.max(0, scrollOffset - 10);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.pageDown)) {
          scrollOffset += 10;
          tui.requestRender();
          return;
        }
      },
      invalidate() {},
    };
  });
}

function buildProgressLines(
  theme: { fg: (color: string, text: string) => string },
  width: number,
  workflowPhase: string,
  subagentProgress: SubagentProgress,
  activeWorkflowRunKind: WorkflowRunKind | null,
  lastWorkflowRunKind: WorkflowRunKind | null,
  workflowUsageTotals: WorkflowUsageTotals,
  compactUsageFooterSummary: (usage: UsageStats | null | undefined) => string,
): string[] {
  const currentLabel = activeWorkflowRunKind ?? lastWorkflowRunKind ?? "workflow";
  return [
    truncateToWidth(theme.fg("accent", "Envoy upsert workflow progress"), width),
    truncateToWidth(theme.fg("dim", "─".repeat(width)), width),
    truncateToWidth(`Phase: ${workflowPhase}`, width),
    truncateToWidth(`Status: ${subagentProgress.status}`, width),
    truncateToWidth(`Detail: ${subagentProgress.detail || "(none)"}`, width),
    truncateToWidth(`Reads: ${subagentProgress.reads}  Bash: ${subagentProgress.bashCalls}`, width),
    truncateToWidth(`Current ${currentLabel}: ${hasUsageStats(subagentProgress.usage) ? compactUsageFooterSummary(subagentProgress.usage) : "(not reported)"}`, width),
    truncateToWidth(
      `Planning total: ${hasUsageStats(workflowUsageTotals.planning) ? compactUsageFooterSummary(workflowUsageTotals.planning) : (workflowUsageTotals.planningIsDirect ? "direct planning (no model usage)" : "(none)")}`,
      width,
    ),
    truncateToWidth(
      `Applying total: ${hasUsageStats(workflowUsageTotals.applying) ? compactUsageFooterSummary(workflowUsageTotals.applying) : (workflowUsageTotals.applyingIsDirect ? "direct apply (no model usage)" : "(none)")}`,
      width,
    ),
    truncateToWidth(`Combined total: ${hasUsageStats(workflowUsageTotals.cumulative) ? compactUsageFooterSummary(workflowUsageTotals.cumulative) : "(none)"}`, width),
    truncateToWidth(theme.fg("dim", ""), width),
    truncateToWidth(theme.fg("accent", "Recent activity"), width),
    ...subagentProgress.events.map((line) => truncateToWidth(`• ${line}`, width)),
    truncateToWidth(theme.fg("dim", "Esc closes. The approval dashboard opens automatically when the plan is ready."), width),
  ].slice(0, WORKFLOW_PROGRESS_HEIGHT);
}

export {
  buildProgressLines,
  requestWorkflowUi,
  summarizeProgressCommand,
  summarizeProgressPath,
  summarizeProgressText,
};
