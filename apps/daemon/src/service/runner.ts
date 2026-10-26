import { execFile } from "node:child_process";

import type { CommandResult, CommandRunner } from "./types.ts";

const COMMAND_TIMEOUT_MS = 30_000;

/** The real runner: `execFile`, no shell, hidden console window on Windows. */
export const execRunner: CommandRunner = (file, args) =>
  new Promise<CommandResult>((resolve) => {
    execFile(
      file,
      args,
      { timeout: COMMAND_TIMEOUT_MS, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr, notFound: false });
          return;
        }
        const failure = error as NodeJS.ErrnoException & { code?: string | number };
        if (typeof failure.code === "number") {
          resolve({ code: failure.code, stdout, stderr, notFound: false });
          return;
        }
        resolve({
          code: -1,
          stdout,
          stderr: stderr || failure.message,
          notFound: failure.code === "ENOENT",
        });
      },
    );
  });
