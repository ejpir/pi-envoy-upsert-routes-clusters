import path from "node:path";
import { createReadTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { GuardContext } from "./guard-context.ts";
import { DOC_READS } from "./constants.ts";
import {
  isAllowedFallbackDocRead,
  isRepeatedFallbackDocRead,
  resolveAllowedFallbackDocReadPath,
} from "./fallback-tool-policy.ts";

export default function (pi: ExtensionAPI) {
  const readTool = createReadTool(process.cwd());
  const previouslyReadPaths = new Set<string>();

  pi.registerTool({
    ...readTool,
    name: "read",
    label: "read",
    description: "Read only the four approved envoy upsert docs during fallback planning. Repeated reads return a short cache-hit reminder.",
    async execute(
      toolCallId: string,
      params: { path?: string },
      signal: AbortSignal | undefined,
      onUpdate: ((update: { content: Array<{ type: string; text: string }> }) => void) | undefined,
      ctx: GuardContext,
    ) {
      const requestedPath = String((params as { path?: string }).path ?? "");
      if (!isAllowedFallbackDocRead(requestedPath, ctx.cwd)) {
        return {
          content: [{
            type: "text",
            text:
              "Access denied: fallback planning may only read these exact docs:\n"
              + Array.from(DOC_READS).map((filePath) => `- ${path.relative(ctx.cwd, filePath) || filePath}`).join("\n"),
          }],
          details: { blocked: true },
        };
      }

      if (isRepeatedFallbackDocRead(requestedPath, ctx.cwd, previouslyReadPaths)) {
        const resolvedPath = resolveAllowedFallbackDocReadPath(requestedPath, ctx.cwd) ?? requestedPath;
        return {
          content: [{
            type: "text",
            text: `Cache hit: ${resolvedPath} was already read earlier in this normalization run. Reuse the earlier tool result instead of rereading it.`,
          }],
          details: { cached: true, path: resolvedPath },
        };
      }

      const resolvedPath = resolveAllowedFallbackDocReadPath(requestedPath, ctx.cwd);
      if (resolvedPath) {
        previouslyReadPaths.add(resolvedPath);
      }
      return readTool.execute(toolCallId, params, signal, onUpdate);
    },
  });

}
