import { extractTextPayload } from "./workflow.ts";

export type NormalizedRequestPayload = Record<string, unknown> | Array<Record<string, unknown>>;

function extractBalancedJsonSnippet(text: string): string | null {
  const startIndex = text.search(/[\[{]/);
  if (startIndex < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractJsonCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (trimmed) {
    candidates.add(trimmed);
  }

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.add(candidate);
    }
  }

  const balanced = extractBalancedJsonSnippet(text);
  if (balanced) {
    candidates.add(balanced.trim());
  }

  return Array.from(candidates);
}

function isRequestRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStructuredRequestPayload(value: unknown): NormalizedRequestPayload | null {
  if (Array.isArray(value)) {
    return value.every(isRequestRecord) ? value : null;
  }

  if (!isRequestRecord(value)) {
    return null;
  }

  const requests = value.requests;
  if (Array.isArray(requests)) {
    return requests.every(isRequestRecord) ? value : null;
  }
  if (isRequestRecord(requests)) {
    return {
      ...value,
      requests: [requests],
    };
  }

  const hasSingleRequestShape = [
    "context",
    "proxy_context",
    "proxyContext",
    "proxy-context",
    "forward_host",
    "forwardHost",
  ].some((key) => key in value);

  return hasSingleRequestShape ? value : null;
}

function parseNormalizedRequestPayload(rawResult: unknown): NormalizedRequestPayload | null {
  const text = extractTextPayload(rawResult).trim();
  if (!text) {
    return null;
  }

  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeStructuredRequestPayload(parsed);
      if (normalized) {
        return normalized;
      }
    } catch {
      // keep trying other candidates
    }
  }

  return null;
}

function stringifyNormalizedRequestPayload(payload: NormalizedRequestPayload): string {
  return JSON.stringify(payload, null, 2);
}

export {
  parseNormalizedRequestPayload,
  stringifyNormalizedRequestPayload,
};
