import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { HttpZaloApi, ZaloApiError } from "./api.ts";

const TOKEN = "1459232241454765289:SECRET-token_x";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function api(...responses: (Response | Error)[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = url instanceof Request ? url.url : url.toString();
    calls.push({
      url: target,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: new HttpZaloApi(TOKEN, fetchFn as typeof fetch), calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("HttpZaloApi", () => {
  test("getMe posts to the bot URL and returns the result", async () => {
    const { client, calls } = api(
      json({ ok: true, result: { id: "1", account_name: "bot.x", account_type: "BASIC" } }),
    );
    await expect(client.getMe()).resolves.toMatchObject({ account_name: "bot.x" });
    expect(calls[0]?.url).toBe(`https://bot-api.zaloplatforms.com/bot${TOKEN}/getMe`);
  });

  test("getUpdates sends the timeout as a string and wraps a single event", async () => {
    const event = { event_name: "message.text.received", message: { message_id: "a" } };
    const { client, calls } = api(json({ ok: true, result: event }));
    await expect(client.getUpdates()).resolves.toEqual([event]);
    expect(calls[0]?.body).toEqual({ timeout: "30" });
  });

  test("getUpdates accepts a list, an empty result and ignores junk", async () => {
    const event = { event_name: "message.image.received" };
    const { client } = api(json({ ok: true, result: [event, 5, null, {}] }), json({ ok: true }));
    await expect(client.getUpdates()).resolves.toEqual([event]);
    await expect(client.getUpdates()).resolves.toEqual([]);
  });

  test("a poll that times out is an empty poll", async () => {
    const { client } = api(json({ ok: false, error_code: 408, description: "Request timeout" }));
    await expect(client.getUpdates()).resolves.toEqual([]);
  });

  test("sendMessage sends chat_id and text", async () => {
    const { client, calls } = api(json({ ok: true, result: { message_id: "m1", date: 1 } }));
    await expect(client.sendMessage("u7", "Hello")).resolves.toMatchObject({ message_id: "m1" });
    expect(calls[0]?.body).toEqual({ chat_id: "u7", text: "Hello" });
  });

  test("sendChatAction asks for the typing indicator", async () => {
    const { client, calls } = api(json({ ok: true }));
    await client.sendChatAction("u7");
    expect(calls[0]?.body).toEqual({ chat_id: "u7", action: "typing" });
  });

  test("maps failures to error kinds without leaking the token", async () => {
    const { client } = api(
      json({ ok: false, error_code: 401, description: `bad ${TOKEN}` }, 401),
      json({ ok: false, error_code: 400, description: "chat_id" }, 400),
      json({ ok: false, error_code: 426, description: "limit" }),
      new TypeError(`fetch failed for /bot${TOKEN}/getMe`),
    );
    const unauthorized = await client.getMe().catch((error: unknown) => error);
    expect(unauthorized).toMatchObject({ kind: "unauthorized", status: 401 });
    expect((unauthorized as Error).message).not.toContain("SECRET");
    await expect(client.getMe()).rejects.toMatchObject({ kind: "bad_request" });
    await expect(client.getMe()).rejects.toMatchObject({ kind: "rate_limited" });
    const network = await client.getMe().catch((error: unknown) => error);
    expect(network).toMatchObject({ kind: "network" });
    expect((network as Error).message).not.toContain("SECRET");
  });

  test("retries when rate limited with HTTP 429, then gives up", async () => {
    const limited = () => json({ ok: false, error_code: 429, description: "slow down" }, 429);
    const { client, calls } = api(limited(), limited(), limited(), limited());
    const result = client.getMe().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ kind: "rate_limited" });
    expect(calls).toHaveLength(4);
  });

  test("download returns the bytes and the declared type", async () => {
    const { client } = api(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png; x=y" } }),
    );
    const file = await client.download("https://cdn.example.com/p.png");
    expect([...file.data]).toEqual([1, 2, 3]);
    expect(file.mimeType).toBe("image/png");
  });

  test("download refuses insecure addresses and oversized files", async () => {
    const { client } = api(new Response(new Uint8Array(10)));
    await expect(client.download("http://cdn.example.com/p.png")).rejects.toBeInstanceOf(
      ZaloApiError,
    );
    await expect(client.download("https://cdn.example.com/p.png", 5)).rejects.toMatchObject({
      kind: "too_large",
    });
  });
});
