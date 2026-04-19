import { existsSync, realpathSync } from "node:fs";
import { DOC_READS } from "./constants.ts";
import { resolvePathArgument } from "./path-utils.ts";

const CANONICAL_DOC_READS = new Set(
  Array.from(DOC_READS).map((filePath) => {
    if (!existsSync(filePath)) {
      return filePath;
    }
    try {
      return realpathSync.native(filePath);
    } catch {
      return filePath;
    }
  }),
);

function resolveAllowedFallbackDocReadPath(requestedPath: string, cwd: string): string | null {
  const resolvedPath = resolvePathArgument(requestedPath, cwd);
  if (!resolvedPath) {
    return null;
  }
  return CANONICAL_DOC_READS.has(resolvedPath) ? resolvedPath : null;
}

function isAllowedFallbackDocRead(requestedPath: string, cwd: string): boolean {
  return resolveAllowedFallbackDocReadPath(requestedPath, cwd) !== null;
}

function isRepeatedFallbackDocRead(
  requestedPath: string,
  cwd: string,
  previouslyReadPaths: ReadonlySet<string>,
): boolean {
  const resolvedPath = resolveAllowedFallbackDocReadPath(requestedPath, cwd);
  return resolvedPath !== null && previouslyReadPaths.has(resolvedPath);
}

export {
  CANONICAL_DOC_READS,
  isAllowedFallbackDocRead,
  isRepeatedFallbackDocRead,
  resolveAllowedFallbackDocReadPath,
};
