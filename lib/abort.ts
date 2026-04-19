import type { ChildProcess } from "node:child_process";

function createAbortError(message = "Operation aborted."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function bindAbortSignal(
  signal: AbortSignal | undefined,
  proc: ChildProcess,
  onAbort: (error: Error) => void,
): () => void {
  if (!signal) {
    return () => {};
  }

  let killTimer: ReturnType<typeof setTimeout> | null = null;
  let aborted = false;

  const abortHandler = () => {
    if (aborted) {
      return;
    }
    aborted = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      // ignore kill errors
    }
    killTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore kill errors
      }
    }, 1000);
    onAbort(createAbortError());
  };

  if (signal.aborted) {
    abortHandler();
    return () => {
      if (killTimer) {
        clearTimeout(killTimer);
      }
    };
  }

  signal.addEventListener("abort", abortHandler, { once: true });
  return () => {
    signal.removeEventListener("abort", abortHandler);
    if (killTimer) {
      clearTimeout(killTimer);
    }
  };
}

export {
  bindAbortSignal,
  createAbortError,
};
