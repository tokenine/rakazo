/**
 * 004-code-mode S6 T28 — the production PtySpawner backed by node-pty.
 *
 * node-pty is a NATIVE module, so it is loaded lazily with a dynamic
 * import() inside the spawner: offline tests, the non-PTY provider paths,
 * and module load itself never touch the binary. This deferred load is the
 * repo's reserved use of dynamic import().
 *
 * The spawner satisfies the exact PtySpawner seam of process-sandbox.ts:
 * it spawns a bash inside the task's workspace tree (resolved with the same
 * processTaskRootDir/taskWorkspaceDirName primitives the provider uses, so
 * the terminal and the task runtime share one source of truth), feeds
 * complete output lines to the TCB scrollback listener, and wires input
 * writes, resize, and dispose. The shell runs with --norc so a host user's
 * shell configuration cannot leak into the task runtime — the same hermetic
 * posture as the spawn-env scrub.
 */

import type { IPty } from "node-pty";
import path from "node:path";
import {
  processTaskRootDir,
  taskWorkspaceDirName,
  type PtyHandle,
  type PtySpawner,
} from "./process-sandbox.js";
import { scrubProcessEnv } from "./process-env-scrub.js";

export function createNodePtySpawner(options: { root?: string } = {}): PtySpawner {
  return async (taskId, cols, rows) => {
    // Deferred load of the native binary (see module comment).
    const nodePty = await import("node-pty");
    const cwd = path.join(processTaskRootDir(options.root), taskWorkspaceDirName(taskId));
    // POSIX-only, like the provider's bash-based execute(); the PTY exists
    // only where the process runtime exists.
    const pty = nodePty.spawn("bash", ["--norc"], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: scrubProcessEnv(process.env),
    });
    return wirePty(pty);
  };
}

/** Split the PTY's raw chunks into complete lines and expose the handle. */
function wirePty(pty: IPty): PtyHandle {
  let listener: ((line: string) => void) | undefined;
  // Output emitted between spawn and listener attach is buffered, so early
  // shell output is never lost to the registration race.
  const buffered: string[] = [];
  let pending = "";

  const toLines = (chunk: string): string[] => {
    pending += chunk;
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    return parts.map((line) => line.replace(/\r$/, ""));
  };

  pty.onData((chunk) => {
    const lines = toLines(chunk);
    if (!listener) {
      buffered.push(...lines);
      return;
    }
    for (const line of lines) listener(line);
  });

  return {
    dispose: () => {
      try {
        pty.kill();
      } catch {
        // Already gone.
      }
    },
    write: (data) => {
      pty.write(data);
    },
    resize: (dim) => {
      pty.resize(dim.cols, dim.rows);
    },
    onData: (registered) => {
      listener = registered;
      for (const line of buffered.splice(0)) registered(line);
    },
  };
}
