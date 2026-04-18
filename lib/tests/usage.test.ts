import { describe, expect, test } from "bun:test";
import {
  addUsageStats,
  compactUsageFooterSummary,
  compactUsageSummary,
  createEmptyUsageStats,
  mergeUsageStats,
} from "../usage.ts";

describe("usage.ts", () => {
  test("accumulates raw usage including nested cost", () => {
    const usage = createEmptyUsageStats();

    addUsageStats(usage, {
      input: 1200,
      output: 340,
      cacheRead: 500,
      cacheWrite: 25,
      totalTokens: 4096,
      cost: { total: 0.0231 },
    });

    expect(usage).toEqual({
      input: 1200,
      output: 340,
      cacheRead: 500,
      cacheWrite: 25,
      cost: 0.0231,
      contextTokens: 4096,
      turns: 0,
    });
  });

  test("merges usage totals while keeping max context tokens", () => {
    const target = createEmptyUsageStats();
    target.contextTokens = 1024;
    mergeUsageStats(target, {
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      cost: 0.5,
      contextTokens: 2048,
      turns: 2,
    });

    expect(target).toEqual({
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      cost: 0.5,
      contextTokens: 2048,
      turns: 2,
    });
  });

  test("formats compact summaries with totals and cost", () => {
    const usage = {
      input: 1200,
      output: 340,
      cacheRead: 500,
      cacheWrite: 25,
      cost: 0.0231,
      contextTokens: 0,
      turns: 1,
    };

    expect(compactUsageSummary(usage)).toBe("↑1.2k ↓340 R500 W25 Σ2.1k");
    expect(compactUsageFooterSummary(usage)).toBe("↑1.2k ↓340 R500 W25 Σ2.1k $0.0231");
  });
});
