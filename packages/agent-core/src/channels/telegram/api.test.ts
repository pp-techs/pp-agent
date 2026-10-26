import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { HttpTelegramApi, isNotModified, isParseError, TelegramApiError } from "./api.ts";

const TOKEN = "123456:SECRET-token_x";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function api(...responses: (Response | Error)[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: new HttpTelegramApi(TOKEN, fetchFn as typeof fetch), calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("HttpTelegramApi", () => {
  test("getMe posts to the bot URL and returns the result", async () => {
    const { client, calls } = api(
      json({ ok: true, result: { id: 1, first_name: "B", username: "b" } }),
    );
    await expect(client.getMe()).resolves.toMatchObject({ username: "b" });
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
  });

  test("getUpdates long polls for messages and callbacks", async () => {
    const { client, calls } = api(json({ ok: true, result: [] }));
    await client.getUpdates(12);
    expect(calls[0]?.body).toEqual({
      offset: 12,
      timeout: 30,
      allowed_updates: ["message", "callback_query"],
    });
  });

  test("maps statuses to typed errors without leaking the token", async () => {
    const cases: [number, string][] = [
      [401, "unauthorized"],
      [409, "conflict"],
      [400, "bad_request"],
      [500, "api"],
    ];
    for (const [status, kind] of cases) {
      const { client } = api(
        json({ ok: false, error_code: status, description: `failed for bot${TOKEN}` }, status),
      );
      const error = await client.getMe().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TelegramApiError);
      expect((error as TelegramApiError).kind).toBe(kind);
      expect((error as Error).message).not.toContain("SECRET");
    }
  });

  test("honors retry_after on flood control, then gives up", async () => {
    const flood = () =>
      json(
        { ok: false, error_code: 429, description: "Too Many", parameters: { retry_after: 3 } },
        429,
      );
    const { client, calls } = api(flood(), json({ ok: true, result: { message_id: 4 } }));
    const sent = client.sendMessage(1, "hi");
    await vi.advanceTimersByTimeAsync(2999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(sent).resolves.toEqual({ message_id: 4 });

    const stubborn = api(flood(), flood(), flood(), flood());
    const failed = stubborn.client.sendMessage(1, "hi").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = (await failed) as TelegramApiError;
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfter).toBe(3);
  });

  test("network errors are typed and redacted", async () => {
    const { client } = api(
      new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getMe`),
    );
    const error = (await client.getMe().catch((e: unknown) => e)) as TelegramApiError;
    expect(error.kind).toBe("network");
    expect(error.message).not.toContain("SECRET");
  });

  test("recognizes parse and not-modified errors", () => {
    expect(
      isParseError(new TelegramApiError("bad_request", "Bad Request: can't parse entities: x")),
    ).toBe(true);
    expect(isParseError(new TelegramApiError("api", "can't parse entities"))).toBe(false);
    expect(
      isNotModified(new TelegramApiError("bad_request", "Bad Request: message is not modified")),
    ).toBe(true);
  });

  test("downloads a file and rejects ones above the limit", async () => {
    const ok = api(
      json({ ok: true, result: { file_path: "photos/a.jpg", file_size: 3 } }),
      new Response(new Uint8Array([1, 2, 3])),
    );
    const file = await ok.client.downloadFile("id");
    expect([...file.data]).toEqual([1, 2, 3]);
    expect(ok.calls[1]?.url).toBe(`https://api.telegram.org/file/bot${TOKEN}/photos/a.jpg`);

    const declared = api(json({ ok: true, result: { file_path: "a", file_size: 30 } }));
    await expect(declared.client.downloadFile("id", 20)).rejects.toMatchObject({
      kind: "too_large",
    });

    const streamed = api(
      json({ ok: true, result: { file_path: "a" } }),
      new Response(new Uint8Array(30)),
    );
    await expect(streamed.client.downloadFile("id", 20)).rejects.toMatchObject({
      kind: "too_large",
    });

    const header = api(
      json({ ok: true, result: { file_path: "a" } }),
      new Response(new Uint8Array(3), { headers: { "content-length": "99999999" } }),
    );
    await expect(header.client.downloadFile("id", 20)).rejects.toMatchObject({ kind: "too_large" });
  });
});
