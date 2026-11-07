import { copyFile, stat, truncate } from "node:fs/promises";

/** Above this size a starting daemon moves the log to `<log>.1` (one old file is kept). */
export const MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Rotates the daemon log by copy and truncate. Whoever started this process (the app, launchd,
 * systemd, the Windows launcher) already opened the file in append mode for its stdout, so a
 * rename would keep this process writing to the old file; after truncation appends start at 0.
 * A missing log, or one Windows keeps locked, stays as it is.
 */
export async function rotateLog(file: string, maxBytes: number = MAX_LOG_BYTES): Promise<boolean> {
  try {
    if ((await stat(file)).size <= maxBytes) return false;
    await copyFile(file, `${file}.1`);
    await truncate(file, 0);
    return true;
  } catch {
    return false;
  }
}
