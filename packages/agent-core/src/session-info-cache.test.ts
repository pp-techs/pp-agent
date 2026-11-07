import { appendFile, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { SessionInfoCache } from "./session-info-cache.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pp-agent-session-info-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const header = (id: string) =>
  JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd: "/work",
  });

const message = (id: string, role: string, content: unknown, timestamp: number) =>
  JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(timestamp).toISOString(),
    message: { role, content, timestamp },
  });

async function writeSession(name: string, lines: string[]): Promise<string> {
  const path = join(dir, `${name}.jsonl`);
  await writeFile(path, `${lines.join("\n")}\n`);
  return path;
}

describe("SessionInfoCache", () => {
  test("reads what the conversation list needs from each file", async () => {
    const path = await writeSession("a", [
      header("a"),
      message("1", "user", [{ type: "text", text: "hello there" }], 1_000),
      message("2", "assistant", [{ type: "toolCall", id: "c1", name: "read" }], 2_000),
      message("3", "toolResult", [{ type: "text", text: '"role":"user" inside output' }], 3_000),
      JSON.stringify({ type: "session_info", id: "4", parentId: "3", name: " Named " }),
    ]);
    await writeFile(join(dir, "not-a-session.jsonl"), '{"type":"other"}\n');
    const [info, ...rest] = await new SessionInfoCache(dir).list();
    expect(rest).toEqual([]);
    expect(info).toEqual({
      path,
      cwd: "/work",
      name: "Named",
      modified: new Date(2_000),
      messageCount: 3,
      firstMessage: "hello there",
    });
  });

  test("returns updated info after a file changes and forgets deleted files", async () => {
    const cache = new SessionInfoCache(dir);
    const path = await writeSession("a", [header("a"), message("1", "user", "first", 1_000)]);
    expect((await cache.list())[0]?.messageCount).toBe(1);

    await appendFile(path, `${message("2", "assistant", "reply", 5_000)}\n`);
    const [updated] = await cache.list();
    expect(updated?.messageCount).toBe(2);
    expect(updated?.modified).toEqual(new Date(5_000));

    await rm(path);
    expect(await cache.list()).toEqual([]);
  });

  test("does not read a file again while its size and modification time stay the same", async () => {
    const cache = new SessionInfoCache(dir);
    const path = await writeSession("a", [header("a"), message("1", "user", "aaaa", 1_000)]);
    // Whole seconds, so setting the time again gives exactly the same `mtimeMs`.
    const time = new Date("2026-01-02T00:00:00.000Z");
    await utimes(path, time, time);
    expect((await cache.list())[0]?.firstMessage).toBe("aaaa");

    // Same size and mtime: the cached info is kept, so the new content is not seen.
    await writeSession("a", [header("a"), message("1", "user", "bbbb", 1_000)]);
    await utimes(path, time, time);
    expect((await cache.list())[0]?.firstMessage).toBe("aaaa");
  });
});
