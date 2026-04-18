import { describe, expect, test } from "bun:test";
import { DOC_READS, ROOT } from "../constants.ts";
import {
  isAllowedFallbackDocRead,
  isRepeatedFallbackDocRead,
  resolveAllowedFallbackDocReadPath,
} from "../fallback-tool-policy.ts";

describe("fallback-tool-policy.ts", () => {
  test("allows only the four approved docs", () => {
    const allowedDoc = Array.from(DOC_READS)[0]!;
    const relativeAllowedDoc = allowedDoc.startsWith(`${ROOT}/`) ? allowedDoc.slice(ROOT.length + 1) : allowedDoc;

    expect(isAllowedFallbackDocRead(allowedDoc, ROOT)).toBe(true);
    expect(isAllowedFallbackDocRead(relativeAllowedDoc, ROOT)).toBe(true);
    expect(isAllowedFallbackDocRead(".pi/skills/envoy-route-cluster-upsert/docs/USAGE.md", ROOT)).toBe(false);
    expect(isAllowedFallbackDocRead("envoy/docker/envoy.yaml.template", ROOT)).toBe(false);
  });

  test("blocks docs outside the fallback allowlist", () => {
    expect(isAllowedFallbackDocRead(".pi/skills/envoy-route-cluster-upsert/docs/ARCHITECTURE.md", ROOT)).toBe(false);
    expect(isAllowedFallbackDocRead(".pi/skills/envoy-route-cluster-upsert/docs/USAGE.md", ROOT)).toBe(false);
  });

  test("resolves allowed doc paths and detects repeated reads", () => {
    const allowedDoc = Array.from(DOC_READS)[0]!;
    const relativeAllowedDoc = allowedDoc.startsWith(`${ROOT}/`) ? allowedDoc.slice(ROOT.length + 1) : allowedDoc;
    const seenPaths = new Set<string>([allowedDoc]);

    expect(resolveAllowedFallbackDocReadPath(relativeAllowedDoc, ROOT)).toBe(allowedDoc);
    expect(isRepeatedFallbackDocRead(relativeAllowedDoc, ROOT, seenPaths)).toBe(true);
    expect(isRepeatedFallbackDocRead(".pi/skills/envoy-route-cluster-upsert/docs/USAGE.md", ROOT, seenPaths)).toBe(false);
  });
});
