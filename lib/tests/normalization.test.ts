import { describe, expect, test } from "bun:test";
import {
  parseNormalizedRequestPayload,
  stringifyNormalizedRequestPayload,
} from "../normalization.ts";

describe("normalization.ts", () => {
  test("parses direct JSON structured request output", () => {
    const payload = parseNormalizedRequestPayload(`{
      "requests": [
        {
          "context": "/app/demo",
          "forward_host": "demo.example.com",
          "flavor": "http"
        }
      ]
    }`);

    expect(payload).not.toBeNull();
    expect(Array.isArray((payload as Record<string, unknown>).requests)).toBe(true);
  });

  test("parses fenced JSON from assistant prose", () => {
    const payload = parseNormalizedRequestPayload(`Use this normalized request:\n\n\`\`\`json
{
  "requests": [
    {
      "context": "/app/demo",
      "forward_host": "demo.example.com",
      "flavor": "http"
    }
  ]
}
\`\`\``);

    expect(payload).not.toBeNull();
    expect(Array.isArray((payload as Record<string, unknown>).requests)).toBe(true);
  });

  test("extracts balanced JSON embedded in assistant prose", () => {
    const payload = parseNormalizedRequestPayload(
      "Return this request please: {\"context\":\"/app/demo\",\"forward_host\":\"demo.example.com\",\"flavor\":\"http\"}",
    );

    expect(payload).not.toBeNull();
    expect((payload as Record<string, unknown>).context).toBe("/app/demo");
  });

  test("rejects non-json normalization output", () => {
    const payload = parseNormalizedRequestPayload("Use this YAML please: requests:\n  - context: /app/demo");

    expect(payload).toBeNull();
  });

  test("extracts JSON code block with single request object", () => {
    const payload = parseNormalizedRequestPayload(`Normalized request:\n\n\`\`\`json
{
  "context": "/app/demo",
  "forward_host": "demo.example.com",
  "flavor": "http"
}
\`\`\``);

    expect(payload).not.toBeNull();
    expect((payload as Record<string, unknown>).context).toBe("/app/demo");
  });

  test("normalizes object-valued requests into an array", () => {
    const payload = parseNormalizedRequestPayload(`{
      "requests": {
        "proxy_context": "bq-az-demo",
        "forward_host": "demo.example.com",
        "flavor": "bq"
      }
    }`);

    expect(payload).not.toBeNull();
    const requests = (payload as { requests: Array<Record<string, unknown>> }).requests;
    expect(Array.isArray(requests)).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.proxy_context).toBe("bq-az-demo");
  });

  test("stringifies normalized payloads consistently", () => {
    const payload = parseNormalizedRequestPayload(`{"context":"/app/demo","forward_host":"demo.example.com","flavor":"http"}`);
    expect(payload).not.toBeNull();
    expect(stringifyNormalizedRequestPayload(payload!)).toContain('"context": "/app/demo"');
  });
});
