import path from "node:path";
import { DOC_READS } from "./constants.ts";

function resolveAllowedFallbackDocReadPath(requestedPath: string, cwd: string): string | null {
  if (!requestedPath.trim()) {
    return null;
  }
  const resolvedPath = path.resolve(cwd, requestedPath);
  return DOC_READS.has(resolvedPath) ? resolvedPath : null;
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
  isAllowedFallbackDocRead,
  isRepeatedFallbackDocRead,
  resolveAllowedFallbackDocReadPath,
};
