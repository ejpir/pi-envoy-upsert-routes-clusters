import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

function stripPathSigil(requestedPath: string): string {
  return requestedPath.trim().replace(/^@+/, "");
}

function resolvePathArgument(requestedPath: string, cwd: string): string | null {
  const cleanedPath = stripPathSigil(requestedPath);
  if (!cleanedPath) {
    return null;
  }

  const absolutePath = path.isAbsolute(cleanedPath)
    ? path.normalize(cleanedPath)
    : path.resolve(cwd, cleanedPath);

  if (existsSync(absolutePath)) {
    try {
      return realpathSync.native(absolutePath);
    } catch {
      return path.normalize(absolutePath);
    }
  }

  return path.normalize(absolutePath);
}

export {
  resolvePathArgument,
  stripPathSigil,
};
