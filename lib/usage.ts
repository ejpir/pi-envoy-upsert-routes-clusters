import type { UsageStats, WorkflowUsageTotals } from "./types.ts";

function createEmptyUsageStats(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  };
}

function createEmptyWorkflowUsageTotals(): WorkflowUsageTotals {
  return {
    planning: createEmptyUsageStats(),
    applying: createEmptyUsageStats(),
    cumulative: createEmptyUsageStats(),
    planningIsDirect: false,
    applyingIsDirect: false,
  };
}

function cloneUsageStats(usage: UsageStats | null | undefined): UsageStats {
  return {
    input: usage?.input ?? 0,
    output: usage?.output ?? 0,
    cacheRead: usage?.cacheRead ?? 0,
    cacheWrite: usage?.cacheWrite ?? 0,
    cost: usage?.cost ?? 0,
    contextTokens: usage?.contextTokens ?? 0,
    turns: usage?.turns ?? 0,
  };
}

function asFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addUsageStats(target: UsageStats, rawUsage: unknown): void {
  if (!rawUsage || typeof rawUsage !== "object") {
    return;
  }

  const usage = rawUsage as {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    totalTokens?: unknown;
    cost?: unknown;
  };

  target.input += asFiniteNumber(usage.input);
  target.output += asFiniteNumber(usage.output);
  target.cacheRead += asFiniteNumber(usage.cacheRead);
  target.cacheWrite += asFiniteNumber(usage.cacheWrite);

  if (typeof usage.cost === "number") {
    target.cost += asFiniteNumber(usage.cost);
  } else if (usage.cost && typeof usage.cost === "object") {
    target.cost += asFiniteNumber((usage.cost as { total?: unknown }).total);
  }

  const contextTokens = asFiniteNumber(usage.totalTokens);
  if (contextTokens > 0) {
    target.contextTokens = contextTokens;
  }
}

function mergeUsageStats(target: UsageStats, source: UsageStats | null | undefined): void {
  if (!source) {
    return;
  }
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.cost += source.cost;
  target.turns += source.turns;
  target.contextTokens = Math.max(target.contextTokens, source.contextTokens);
}

function totalUsageTokens(usage: UsageStats | null | undefined): number {
  if (!usage) {
    return 0;
  }
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function hasUsageStats(usage: UsageStats | null | undefined): boolean {
  return !!usage && (
    usage.turns > 0 ||
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    usage.cost > 0 ||
    usage.contextTokens > 0
  );
}

function formatTokenCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function compactUsageSummary(usage: UsageStats | null | undefined): string {
  if (!hasUsageStats(usage)) {
    return "";
  }

  const parts: string[] = [];
  if ((usage?.input ?? 0) > 0) parts.push(`↑${formatTokenCount(usage!.input)}`);
  if ((usage?.output ?? 0) > 0) parts.push(`↓${formatTokenCount(usage!.output)}`);
  if ((usage?.cacheRead ?? 0) > 0) parts.push(`R${formatTokenCount(usage!.cacheRead)}`);
  if ((usage?.cacheWrite ?? 0) > 0) parts.push(`W${formatTokenCount(usage!.cacheWrite)}`);
  const total = totalUsageTokens(usage);
  if (total > 0) parts.push(`Σ${formatTokenCount(total)}`);
  return parts.join(" ");
}

function compactUsageFooterSummary(usage: UsageStats | null | undefined): string {
  const summary = compactUsageSummary(usage);
  if (!summary) {
    return "";
  }
  if ((usage?.cost ?? 0) > 0) {
    return `${summary} $${usage!.cost.toFixed(4)}`;
  }
  return summary;
}

export {
  addUsageStats,
  cloneUsageStats,
  compactUsageFooterSummary,
  compactUsageSummary,
  createEmptyUsageStats,
  createEmptyWorkflowUsageTotals,
  formatTokenCount,
  hasUsageStats,
  mergeUsageStats,
  totalUsageTokens,
};
