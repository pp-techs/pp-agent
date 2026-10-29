import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import type { TerminalBacklog, TerminalInfo, TerminalSize } from "@workspace/shared";
import { type IPty, spawn } from "node-pty";
import { translator } from "../i18n.ts";

const MAX_TERMINALS = 12;
/** Output kept per terminal for a panel that shows it again (about 3000 full lines). */
const BACKLOG_CHARS = 256 * 1024;
/** Output is sent at most this often per terminal; a busy command writes thousands of chunks. */
const FLUSH_MS = 8;

interface Terminal {
  info: TerminalInfo;
  pty: IPty;
  backlog: string;
  seq: number;
  pending: string;
  timer: NodeJS.Timeout | null;
}

export interface TerminalHostOptions {
  onData(id: string, data: string, seq: number): void;
  onChanged(terminals: TerminalInfo[]): void;
}

/** The person's login shell: it loads their PATH, which a GUI app on macOS does not inherit. */
function defaultShell(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    const powershell = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    return existsSync(powershell)
      ? { file: powershell, args: ["-NoLogo"] }
      : { file: process.env.COMSPEC ?? "cmd.exe", args: [] };
  }
  const shell = process.env.SHELL;
  const file =
    shell && existsSync(shell) ? shell : existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash";
  return { file, args: ["-l"] };
}

function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("ELECTRON_")) env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.TERM_PROGRAM = "PP Agent";
  if (process.platform !== "win32" && !env.LANG) env.LANG = "en_US.UTF-8";
  return env;
}

/**
 * node-pty 1.1 ships its macOS `spawn-helper` without the execute bit, and spawning fails with
 * "posix_spawnp failed". Development checkouts get it fixed here; packaged builds get it at pack
 * time (`scripts/after-pack.cjs`), where the app bundle is still writable.
 */
function ensureSpawnHelper(): void {
  if (process.platform !== "darwin") return;
  try {
    const require = createRequire(import.meta.url);
    const root = dirname(dirname(require.resolve("node-pty")));
    const helper = join(root, "prebuilds", `darwin-${process.arch}`, "spawn-helper").replace(
      "app.asar",
      "app.asar.unpacked",
    );
    try {
      accessSync(helper, constants.X_OK);
    } catch {
      chmodSync(helper, 0o755);
    }
  } catch (error) {
    console.error("Could not prepare the terminal helper:", error);
  }
}

function validSize(size: TerminalSize): TerminalSize {
  const clamp = (value: number, max: number) =>
    Number.isInteger(value) ? Math.min(Math.max(value, 2), max) : 80;
  return { cols: clamp(size.cols, 1000), rows: clamp(size.rows, 500) };
}

/**
 * Shells the person opens in the side panel. They live in the main process, not the daemon: they
 * are the person's, never the agent's, and end with the window.
 */
export class TerminalHost {
  private readonly terminals = new Map<string, Terminal>();
  private nextId = 1;
  private helperChecked = false;

  constructor(private readonly options: TerminalHostOptions) {}

  list(): TerminalInfo[] {
    return [...this.terminals.values()].map((terminal) => ({ ...terminal.info }));
  }

  create(cwd: string, size: TerminalSize): TerminalInfo {
    const t = translator();
    if (this.terminals.size >= MAX_TERMINALS)
      throw new Error(t("panel.terminal.tooMany", { max: MAX_TERMINALS }));
    if (!this.helperChecked) {
      ensureSpawnHelper();
      this.helperChecked = true;
    }
    const { file, args } = defaultShell();
    const { cols, rows } = validSize(size);
    let pty: IPty;
    try {
      pty = spawn(file, args, { name: "xterm-256color", cols, rows, cwd, env: shellEnv() });
    } catch (error) {
      throw new Error(
        t("panel.terminal.startFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    const id = `term-${this.nextId++}`;
    const terminal: Terminal = {
      info: { id, cwd, title: basename(file).replace(/\.exe$/i, ""), exited: false },
      pty,
      backlog: "",
      seq: 0,
      pending: "",
      timer: null,
    };
    this.terminals.set(id, terminal);
    pty.onData((data) => {
      terminal.pending += data;
      terminal.timer ??= setTimeout(() => this.flush(terminal), FLUSH_MS);
    });
    pty.onExit(() => {
      this.flush(terminal);
      terminal.info.exited = true;
      this.changed();
    });
    this.changed();
    return { ...terminal.info };
  }

  backlog(id: string): TerminalBacklog {
    const terminal = this.require(id);
    return { output: terminal.backlog, seq: terminal.seq };
  }

  write(id: string, data: string): void {
    const terminal = this.terminals.get(id);
    if (terminal && !terminal.info.exited) terminal.pty.write(data);
  }

  resize(id: string, size: TerminalSize): void {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.info.exited) return;
    const { cols, rows } = validSize(size);
    try {
      terminal.pty.resize(cols, rows);
    } catch {
      // The shell ended between the check and the call.
    }
  }

  close(id: string): void {
    const terminal = this.require(id);
    this.end(terminal);
    this.terminals.delete(id);
    this.changed();
  }

  /** Ends every shell (the window closed or the app quits). */
  dispose(): void {
    for (const terminal of this.terminals.values()) this.end(terminal);
    this.terminals.clear();
  }

  private require(id: string): Terminal {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error(translator()("panel.terminal.notFound"));
    return terminal;
  }

  private end(terminal: Terminal): void {
    if (terminal.timer) clearTimeout(terminal.timer);
    terminal.timer = null;
    if (!terminal.info.exited) {
      try {
        terminal.pty.kill();
      } catch {
        // Already gone.
      }
    }
  }

  private flush(terminal: Terminal): void {
    if (terminal.timer) clearTimeout(terminal.timer);
    terminal.timer = null;
    if (!terminal.pending) return;
    const data = terminal.pending;
    terminal.pending = "";
    terminal.seq += 1;
    terminal.backlog = (terminal.backlog + data).slice(-BACKLOG_CHARS);
    this.options.onData(terminal.info.id, data, terminal.seq);
  }

  private changed(): void {
    this.options.onChanged(this.list());
  }
}
