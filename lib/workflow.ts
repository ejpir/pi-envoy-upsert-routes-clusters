import { WORKFLOW_SCRIPT_PATH } from "./constants.ts";
import type { UpsertWorkflowResult } from "./types.ts";

function extractTextPayload(rawResult: unknown): string {
  if (typeof rawResult === "string") {
    return rawResult;
  }

  if (rawResult === null || rawResult === undefined) {
    return "";
  }

  if (Array.isArray(rawResult)) {
    return rawResult
      .map((item) => (typeof item === "string" ? item : ""))
      .filter((item) => item.length > 0)
      .join("\n");
  }

  const result = rawResult as {
    content?: Array<{ type?: string; text?: string }>;
    output?: string;
    message?: string;
  };

  if (typeof result.output === "string") {
    return result.output;
  }

  if (typeof result.message === "string") {
    return result.message;
  }

  if (Array.isArray(result.content)) {
    return result.content
      .filter((item) => item && item.type === "text")
      .map((item) => (typeof (item as { text?: string }).text === "string" ? (item as { text?: string }).text : ""))
      .join("\n");
  }

  return "";
}

function extractFirstInt(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match?.[1]) {
    return null;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function extractRouteClusterCounts(text: string): { routes: number; clusters: number } {
  const routesFromPair = /(\d+)\s*route\s*\+\s*(\d+)\s*cluster/i.exec(text);
  if (routesFromPair) {
    return {
      routes: Number.parseInt(routesFromPair[1], 10),
      clusters: Number.parseInt(routesFromPair[2], 10),
    };
  }

  const routeCount =
    extractFirstInt(text, /add\s+(\d+)\s+route/i) ??
    extractFirstInt(text, /add(?:ed)?\s+(\d+)\s+routes?/i) ??
    extractFirstInt(text, /(\d+)\s+route/i) ??
    0;

  const clusterCount =
    extractFirstInt(text, /\+\s*(\d+)\s+cluster/i) ??
    extractFirstInt(text, /and\s+(\d+)\s+cluster/i) ??
    extractFirstInt(text, /add\s+(\d+)\s+cluster/i) ??
    extractFirstInt(text, /(\d+)\s+cluster/i) ??
    0;

  return { routes: routeCount, clusters: clusterCount };
}

function inferWorkflowResultFromHumanMessage(rawResult: unknown): UpsertWorkflowResult | null {
  const text = extractTextPayload(rawResult).trim();
  if (!text) {
    return null;
  }

  const collapsed = text.toLowerCase().replace(/\s+/g, " ");
  const indicatesPendingApproval =
    /approval needed/.test(collapsed) ||
    /please approve/.test(collapsed) ||
    /reply\s+approve/.test(collapsed) ||
    /please apply/.test(collapsed) ||
    /re-run with --approve/.test(collapsed) ||
    /state:\s*waiting_approval/.test(collapsed) ||
    /planned changes are ready/.test(collapsed) ||
    /planned adds are/.test(collapsed) ||
    /awaiting explicit approval/.test(collapsed) ||
    /changes are required/.test(collapsed) ||
    /next:\s*apply/.test(collapsed);

  if (!indicatesPendingApproval) {
    return null;
  }

  const { routes: routeCount, clusters: clusterCount } = extractRouteClusterCounts(text);
  const warningCount = extractFirstInt(text, /(\d+)\s+warning/i) ?? 0;
  const contextMatch = text.match(/context\s+([^\s,(]+)/i);
  const targetVirtualHostMatch = text.match(/in\s+([^,\n]+)/i);

  return {
    schema_version: "upsert-workflow-v1",
    state: "WAITING_APPROVAL",
    status: "waiting_approval",
    target_virtual_host: contextMatch?.[1] ?? targetVirtualHostMatch?.[1]?.trim() ?? undefined,
    summary: {
      add_routes: routeCount,
      add_clusters: clusterCount,
      skipped_route_exists: 0,
      skipped_route_overlap: 0,
      warnings: warningCount,
    },
    warnings: warningCount > 0 ? [{ message: `Detected ${warningCount} warning(s) in workflow output` }] : [],
    next_step: "apply",
    message: text,
  };
}

function parseWorkflowResult(rawResult: unknown): UpsertWorkflowResult | null {
  const text = extractTextPayload(rawResult).trim();
  if (!text) {
    return null;
  }

  const candidates: string[] = [text];
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as UpsertWorkflowResult;
      if (parsed?.schema_version === "upsert-workflow-v1") {
        return parsed;
      }
    } catch {
      // keep trying other candidates
    }
  }

  return inferWorkflowResultFromHumanMessage(text);
}

function asDetailRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildWorkflowToolDetails(existingDetails: unknown, workflowResult: UpsertWorkflowResult): Record<string, unknown> {
  return {
    ...asDetailRecord(existingDetails),
    workflowResult,
    hiddenByUpsertGuard: true,
  };
}

function isWorkflowCommand(command: string): boolean {
  return command.includes(`python3 ${WORKFLOW_SCRIPT_PATH}`);
}

function isAllowedWorkflowCommand(command: string): boolean {
  return isWorkflowCommand(command)
    && !/(--help|\bls\b|\bfind\b|\brg\b|\bgrep\b|\bcp\b|\bmv\b|\bsed\b|\bawk\b)/.test(command);
}

function isApproveWorkflowCommand(command: string): boolean {
  return isWorkflowCommand(command) && /(^|\s)--approve(\s|$)/.test(command);
}

const APPROVAL_NEGATION_PATTERNS = [
  /\bdo\s+not\s+(?:approve|apply)\b/i,
  /\bdon't\s+(?:approve|apply)\b/i,
  /\bdont\s+(?:approve|apply)\b/i,
  /\bnot\s+approved\b/i,
  /\bnot\s+yet\s+approved\b/i,
  /\bwithout\s+approval\b/i,
  /\bwait\s+for\s+approval\b/i,
  /\bneeds\s+approval\b/i,
  /\bbefore\s+i\s+approve\b/i,
  /\buntil\s+i\s+approve\b/i,
  /\bdon't\s+apply\s+yet\b/i,
  /\bdo\s+not\s+apply\s+yet\b/i,
  /\bnot\s+ready\s+to\s+apply\b/i,
  /\bno\s*,?\s+do\s+not\s+apply\b/i,
  /\bif\s+approved\b/i,
];

const APPROVAL_POSITIVE_PATTERNS = [
  /\bapproved\b/i,
  /\bapproval\s+granted\b/i,
  /\byou\s+may\s+apply\b/i,
  /\bgo\s+ahead\s+and\s+apply\b/i,
  /\bplease\s+apply\b/i,
  /\byes\s*,?\s+apply\b/i,
  /\bapply\s+it\s+now\b/i,
  /\bapply\s+the\s+pending\b/i,
  /\bproceed\s+with\s+apply\b/i,
  /\bproceed\s+with\s+approval\b/i,
];

function hasExplicitApproval(prompt: string): boolean {
  const text = prompt.toLowerCase();
  if (APPROVAL_NEGATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return APPROVAL_POSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function shouldGuard(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return [
    "envoy-route-cluster-upsert",
    "use the upsert skill",
    "upsert skill",
    "proxy context",
    "s3_prefix_rewrite",
    "public path",
    "forwarded path",
    "application host endpoint",
  ].some((needle) => text.includes(needle));
}

function shouldOfferApproval(result: UpsertWorkflowResult): boolean {
  return result.next_step === "apply" || result.state === "WAITING_APPROVAL";
}

function shouldFallbackToModelPlanning(result: {
  workflowResult: UpsertWorkflowResult | null;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}): boolean {
  const workflowResult = result.workflowResult;
  if (!workflowResult) {
    return true;
  }

  if (workflowResult.state !== "ERROR") {
    return false;
  }

  const errorKind = (workflowResult.error_kind ?? "").toLowerCase();
  if (errorKind === "manual_review_required") {
    return true;
  }

  const combinedText = [
    workflowResult.message ?? "",
    result.stdout ?? "",
    result.stderr ?? "",
  ].join("\n").toLowerCase();

  const nonRecoverableSignals = [
    "no virtual host matched",
    "multiple virtual hosts matched",
    "template hash mismatch",
    "request hash mismatch",
    "approval requires an existing --state-file",
  ];
  if (nonRecoverableSignals.some((needle) => combinedText.includes(needle))) {
    return false;
  }

  const ambiguitySignals = [
    "no proxy-context input received",
    "could not parse",
    "could not determine forward host",
    "inline yaml was parsed as plain text",
    "missing context",
    "missing context/proxy_context",
    "forward_host is required",
    "invalid context",
    "invalid flavor",
    "invalid match_mode",
    "structured request item",
    "manual review",
  ];

  return ambiguitySignals.some((needle) => combinedText.includes(needle));
}

function compactWorkflowResultSummary(result: UpsertWorkflowResult): string {
  const routeCount = result.summary?.add_routes ?? result.additions?.routes?.length ?? 0;
  const clusterCount = result.summary?.add_clusters ?? result.additions?.clusters?.length ?? 0;
  if (shouldOfferApproval(result)) {
    return `Approval needed · ${routeCount} route(s), ${clusterCount} cluster(s)`;
  }
  if (routeCount === 0 && clusterCount === 0) {
    return "Ready · no changes required";
  }
  return `Ready · ${routeCount} route(s), ${clusterCount} cluster(s)`;
}

function prettyState(result: UpsertWorkflowResult): string {
  const pending = result.next_step === "apply" || result.state === "WAITING_APPROVAL";
  if (pending) return "Pending approval";
  if ((result.summary?.add_routes ?? 0) === 0 && (result.summary?.add_clusters ?? 0) === 0) return "No changes needed";
  return "Check complete";
}

function buildApprovalPrompt(): string {
  return "Approved: you may apply the pending envoy-route-cluster-upsert changes now. Use the prior waiting-approval state and proceed with --approve.";
}

export {
  asDetailRecord,
  buildApprovalPrompt,
  buildWorkflowToolDetails,
  compactWorkflowResultSummary,
  extractTextPayload,
  hasExplicitApproval,
  isAllowedWorkflowCommand,
  isApproveWorkflowCommand,
  isWorkflowCommand,
  parseWorkflowResult,
  prettyState,
  shouldGuard,
  shouldOfferApproval,
  shouldFallbackToModelPlanning,
};
