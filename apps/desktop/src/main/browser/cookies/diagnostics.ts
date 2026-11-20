import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

/** Where cookie import notes go: beside the app's other data, so a support request can attach it. */
export function diagLogPath(): string {
  try {
    return join(app.getPath("userData"), "cookie-import-diag.log");
  } catch {
    return join(tmpdir(), "pp-agent-cookie-import-diag.log");
  }
}

/** Best-effort note about an import (never a cookie value), in the log file and the console. */
export function diag(message: string): void {
  try {
    appendFileSync(diagLogPath(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Diagnostics must never break an import.
  }
  console.log("[cookie-import]", message);
}
