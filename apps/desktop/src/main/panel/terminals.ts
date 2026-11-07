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
/** Output sent to a watching view but not yet drawn: above this the shell is paused... */
const PAUSE_UNACKED_CHARS = 512 * 1024;
/** ...and once the view has drawn all but this much, it runs again. */
const RESUME_UNACKED_CHARS = 64 * 1024;
/** The ring compacts its array once this many dropped chunks sit at its head. */
const RING_COMPACT_CHUNKS = 1024;

/**
 * The most recent output as whole chunks and a character count: adding a chunk never copies the
 * kept text, and only a view that shows the terminal again joins it.
 */
class OutputRing {
  private chunks: string[] = [];
  private head = 0;
  private chars = 0;

  constructor(private readonly maxChars: number) {}

  push(data: string): void {
    this.chunks.push(data);
    this.chars += data.length;
    // Drop the oldest chunks while what is left still fills the ring.
    while (this.chars - (this.chunks[this.head]?.length ?? 0) >= this.maxChars) {
      this.chars -= this.chunks[this.head]?.length ?? 0;
      this.head += 1;
    }
    if (this.head >= RING_COMPACT_CHUNKS && this.head * 2 >= this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }

  text(): string {
    return this.chunks.slice(this.head).join("");
  }
}

interface Terminal {
  info: TerminalInfo;
  pty: IPty;
  backlog: OutputRing;
  seq: number;
  pending: string;
  timer: NodeJS.Timeout | null;
  /** A view shows this terminal (it read the backlog and has not detached), so it acks output. */
  watched: boolean;
  /** Characters sent to the watching view that it has not acked yet. */
  unacked: number;
  /** The shell is paused because the view fell behind. */
  paused: boolean;
  /** Closed or disposed: late output and exit of the shell are dropped (the window may be gone). */
  closed: boolean;
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
      backlog: new OutputRing(BACKLOG_CHARS),
      seq: 0,
      pending: "",
      timer: null,
      watched: false,
      unacked: 0,
      paused: false,
      closed: false,
    };
    this.terminals.set(id, terminal);
    pty.onData((data) => {
      if (terminal.closed) return;
      terminal.pending += data;
      terminal.timer ??= setTimeout(() => this.flush(terminal), FLUSH_MS);
    });
    pty.onExit(() => {
      if (terminal.closed) return;
      this.flush(terminal);
      terminal.info.exited = true;
      this.changed();
    });
    this.changed();
    return { ...terminal.info };
  }

  /**
   * Output so far, for a view that starts showing the terminal. From here on the view acks what
   * it draws (`ack`), and the shell pauses while too much is waiting, until it calls `detach`.
   */
  backlog(id: string): TerminalBacklog {
    const terminal = this.require(id);
    terminal.watched = true;
    // The backlog is not counted; only chunks sent from now on are acked.
    terminal.unacked = 0;
    this.resume(terminal);
    return { output: terminal.backlog.text(), seq: terminal.seq };
  }

  /** The watching view drew `chars` more characters of output. */
  ack(id: string, chars: number): void {
    const terminal = this.terminals.get(id);
    if (!terminal?.watched) return;
    terminal.unacked = Math.max(0, terminal.unacked - chars);
    if (terminal.unacked <= RESUME_UNACKED_CHARS) this.resume(terminal);
  }

  /** No view shows the terminal any more: nobody acks, so output is no longer held back. */
  detach(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    terminal.watched = false;
    terminal.unacked = 0;
    this.resume(terminal);
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
    terminal.closed = true;
    clearTimeout(terminal.timer ?? undefined);
    terminal.timer = null;
    if (!terminal.info.exited) {
      try {
        terminal.pty.kill();
      } catch {
        // Already gone.
      }
    }
  }

  private resume(terminal: Terminal): void {
    if (!terminal.paused) return;
    terminal.paused = false;
    if (terminal.closed || terminal.info.exited) return;
    try {
      terminal.pty.resume();
    } catch {
      // The shell ended between the check and the call.
    }
  }

  private flush(terminal: Terminal): void {
    clearTimeout(terminal.timer ?? undefined);
    terminal.timer = null;
    if (!terminal.pending) return;
    const data = terminal.pending;
    terminal.pending = "";
    terminal.seq += 1;
    terminal.backlog.push(data);
    this.options.onData(terminal.info.id, data, terminal.seq);
    if (!terminal.watched) return;
    terminal.unacked += data.length;
    if (terminal.unacked > PAUSE_UNACKED_CHARS && !terminal.paused && !terminal.info.exited) {
      terminal.paused = true;
      try {
        terminal.pty.pause();
      } catch {
        // The shell ended between the check and the call.
      }
    }
  }

  private changed(): void {
    this.options.onChanged(this.list());
  }
}
