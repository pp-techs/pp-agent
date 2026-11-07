import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, ChatMessage } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { AuditLog, auditEntryFor, buildReport, readTail, redact } from "./audit-log.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pp-audit-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function lines(log: AuditLog): Promise<Array<Record<string, unknown>>> {
  return (await log.read())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const failedTurn: ChatMessage = {
  id: "m1",
  role: "assistant",
  parts: [],
  error: "The model returned an error.",
  errorDetail: "openai/gpt-x: 500 upstream exploded",
};

describe("redact", () => {
  test("hides keys, tokens and cookies but keeps the rest of the text", () => {
    const text = redact(
      'Incorrect API key sk-abcdefghijklmnopqrstu, Authorization: Bearer abc.def-ghi_jklmnop, {"apiKey":"hunter2"} https://x.test/a?token=zzz&page=2',
    );
    expect(text).not.toContain("sk-abcdefghijklmnopqrstu");
    expect(text).not.toContain("abc.def-ghi_jklmnop");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("zzz");
    expect(text).toContain("page=2");
    expect(text).toContain("Incorrect API key");
  });

  test("writes the home folder as ~", () => {
    expect(redact("/Users/jane/Documents/PP Agent/a.txt", "/Users/jane")).toBe(
      "~/Documents/PP Agent/a.txt",
    );
  });

  test("drops inline file data", () => {
    const text = redact(`image data:image/png;base64,${"A".repeat(200)} end`);
    expect(text).toBe("image data:[base64 omitted] end");
  });
});

describe("auditEntryFor", () => {
  test("keeps a failed turn with what the provider said", () => {
    const entry = auditEntryFor({ type: "message", message: failedTurn });
    expect(entry?.kind).toBe("model_error");
    expect(entry?.data.detail).toBe("openai/gpt-x: 500 upstream exploded");
  });

  test("ignores messages, which are the conversation itself", () => {
    const message: ChatMessage = {
      id: "m2",
      role: "user",
      parts: [{ type: "text", text: "my secret plans" }],
    };
    expect(auditEntryFor({ type: "message", message })).toBeNull();
    expect(auditEntryFor({ type: "sessions_changed" })).toBeNull();
  });

  test("keeps which tool asked for approval, not what it was going to do", () => {
    const event = {
      type: "approval_requested",
      request: {
        requestId: "r1",
        toolName: "bash",
        tier: "dangerous",
        title: "Run rm -rf secrets",
        detail: "rm -rf secrets",
      },
    } as unknown as AgentEvent;
    const entry = auditEntryFor(event);
    expect(entry?.data).toEqual({ requestId: "r1", tool: "bash", tier: "dangerous" });
  });
});

describe("AuditLog", () => {
  test("writes one redacted JSON line per record", async () => {
    const log = new AuditLog({ dir, home: "/Users/jane" });
    log.record("agent_error", { message: "cannot read /Users/jane/x with token=abc123" });
    const [entry] = await lines(log);
    expect(entry?.kind).toBe("agent_error");
    expect(entry?.message).toBe("cannot read ~/x with token=[redacted]");
    expect(typeof entry?.time).toBe("string");
  });

  test("logs a failed turn once, however often its message is sent", async () => {
    const log = new AuditLog({ dir });
    const event: AgentEvent = { type: "message", message: failedTurn };
    log.event(event, { session: "s1" });
    log.event(event, { session: "s1" });
    const entries = await lines(log);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.session).toBe("s1");
  });

  test("logs the same message id again when it comes from another conversation", async () => {
    const log = new AuditLog({ dir });
    const event: AgentEvent = { type: "message", message: failedTurn };
    log.event(event, { session: "s1" });
    log.event(event, { session: "s2" });
    log.event(event, { session: null });
    log.event(event, { session: null });
    expect((await lines(log)).map((entry) => entry.session)).toEqual(["s1", "s2", null, null]);
  });

  test("rotates when full and keeps the older file", async () => {
    const log = new AuditLog({ dir, maxBytes: 300 });
    for (let i = 0; i < 12; i += 1) log.record("tick", { i });
    const all = (await lines(log)).map((entry) => entry.i as number);
    expect(readFileSync(join(dir, "audit.1.log"), "utf8")).toContain('"kind":"tick"');
    expect(all.at(-1)).toBe(11);
    // Only the newest part survives two rotations, and it stays in order.
    expect(all).toEqual([...all].sort((a, b) => a - b));
    expect(await log.bytes()).toBeLessThan(700);
  });

  test("keeps lines in order across separate writes", async () => {
    const log = new AuditLog({ dir });
    log.record("tick", { i: 0 });
    await log.bytes();
    log.record("tick", { i: 1 });
    log.record("tick", { i: 2 });
    expect((await lines(log)).map((entry) => entry.i)).toEqual([0, 1, 2]);
  });

  test("clear removes both files", async () => {
    const log = new AuditLog({ dir, maxBytes: 100 });
    for (let i = 0; i < 6; i += 1) log.record("tick", { i });
    await log.clear();
    expect(await log.read()).toBe("");
    expect(await log.bytes()).toBe(0);
  });

  test("does not throw when the folder cannot be written", async () => {
    const log = new AuditLog({ dir: join(dir, "missing", "deeper") });
    rmSync(dir, { recursive: true, force: true });
    expect(() => log.record("tick")).not.toThrow();
    expect(await log.read()).toBe("");
  });
});

describe("readTail", () => {
  test("returns whole lines from the end of the file", () => {
    const path = join(dir, "daemon.log");
    writeFileSync(path, "first line\nsecond line\nthird line\n");
    expect(readTail(path, 20)).toBe("third line\n");
    expect(readTail(path, 1000)).toBe("first line\nsecond line\nthird line\n");
    expect(readTail(join(dir, "nope.log"), 10)).toBe("");
  });
});

describe("buildReport", () => {
  test("joins the facts, the audit log and the redacted daemon log", async () => {
    const log = new AuditLog({ dir });
    log.record("app_start");
    const daemonLog = join(dir, "daemon.log");
    writeFileSync(daemonLog, "[model] 401 bad key sk-abcdefghijklmnopqrstu\n");
    const report = await buildReport(log, {
      facts: { App: "1.2.3" },
      daemonLog,
      daemonLogBytes: 4096,
    });
    expect(report).toContain("App: 1.2.3");
    expect(report).toContain('"kind":"app_start"');
    expect(report).toContain("[model] 401 bad key [redacted]");
    expect(report).not.toContain("sk-abcdefghijklmnopqrstu");
  });
});
