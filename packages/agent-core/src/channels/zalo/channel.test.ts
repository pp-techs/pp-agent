import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { ChannelState } from "@workspace/shared";
import { PairingGuard } from "../shared/pairing.ts";
import { FakeGateway, approvalRequest, questionRequest } from "../shared/testing.ts";
import { ZaloApiError, type ZaloUpdate } from "./api.ts";
import { MAX_QUEUED_MESSAGES, MESSAGE_LIMIT, ZaloChannel, type ZaloOwner } from "./channel.ts";
import { FakeZaloApi, fakeT, textUpdate } from "./testing.ts";

const OWNER: ZaloOwner = { id: "u7", name: "Ann" };
const channels: ZaloChannel[] = [];

function setup(initialOwner: ZaloOwner | null = OWNER) {
  const api = new FakeZaloApi();
  const gateway = new FakeGateway();
  const pairing = new PairingGuard();
  const state = { owner: initialOwner };
  const paired: ZaloOwner[] = [];
  const states: [ChannelState, string | null][] = [];
  const channel = new ZaloChannel({
    token: "123:secret",
    api,
    gateway,
    pairing,
    owner: () => state.owner,
    onPaired: (owner) => {
      state.owner = owner;
      paired.push(owner);
    },
    onState: (value, error) => states.push([value, error]),
    t: fakeT,
  });
  channels.push(channel);
  return { api, gateway, pairing, state, paired, states, channel };
}

function media(extra: Partial<NonNullable<ZaloUpdate["message"]>>, event: string): ZaloUpdate {
  return {
    event_name: event,
    message: {
      message_id: `media${Math.random()}`,
      from: { id: "u7", display_name: "Ann", is_bot: false },
      chat: { id: "u7", chat_type: "PRIVATE" },
      ...extra,
    },
  };
}

afterEach(async () => {
  await Promise.all(channels.splice(0).map((channel) => channel.stop()));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("start and stop", () => {
  test("goes online, removes the webhook and reports the bot name", async () => {
    const { api, channel, states } = setup();
    expect(await channel.start()).toBe("bot.pp");
    expect(api.webhookDeleted).toBe(1);
    expect(states).toEqual([
      ["connecting", null],
      ["online", null],
    ]);
    await channel.stop();
    expect(states.at(-1)).toEqual(["off", null]);
  });

  test("a webhook that cannot be deleted does not stop the bot", async () => {
    const { api, channel, states } = setup();
    api.deleteWebhookError = new ZaloApiError("bad_request", "no webhook", 400);
    expect(await channel.start()).toBe("bot.pp");
    expect(states.at(-1)).toEqual(["online", null]);
  });

  test("a refused token is an error state and nothing polls", async () => {
    const { api, channel, states } = setup();
    api.getMeError = new ZaloApiError("unauthorized", "Unauthorized", 401);
    expect(await channel.start()).toBeNull();
    expect(states.at(-1)).toEqual(["error", "channels.zalo.tokenInvalid"]);
  });

  test("keeps retrying when Zalo cannot be reached", async () => {
    vi.useFakeTimers();
    const { api, channel, states } = setup();
    api.getMeError = new ZaloApiError("network", "fetch failed");
    expect(await channel.start()).toBeNull();
    expect(states.at(-1)?.[0]).toBe("error");
    api.getMeError = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toEqual(["online", null]);
  });
});

describe("who is answered", () => {
  test("the owner's text becomes a turn and the answer is sent", async () => {
    const { api, gateway, channel } = setup();
    gateway.handler = async () => ({ text: "Hello Ann", status: "done" });
    await channel.start();
    api.push(textUpdate(1, "Hi"));
    await vi.waitFor(() => expect(api.texts).toEqual(["Hello Ann"]));
    expect(gateway.turns[0]?.chatKey).toBe("zalo:u7");
    expect(gateway.turns[0]?.input).toEqual({ text: "Hi", attachments: [] });
    expect(api.actions).toContain("u7");
  });

  test("strangers, groups, bots and repeats are ignored", async () => {
    const { api, gateway, channel } = setup();
    await channel.start();
    api.push(textUpdate(1, "hello", "u99"));
    api.push(textUpdate(2, "hello", "u7", "GROUP"));
    const bot = textUpdate(3, "hello");
    bot.message!.from!.is_bot = true;
    api.push(bot);
    api.push(textUpdate(4, "once"));
    api.push(textUpdate(4, "once"));
    await vi.waitFor(() => expect(api.texts).toEqual(["ok"]));
    expect(gateway.turns.map((turn) => turn.input.text)).toEqual(["once"]);
  });

  test("a long answer is split below Zalo's limit", async () => {
    const { api, gateway, channel } = setup();
    gateway.handler = async () => ({ text: "word ".repeat(1000).trim(), status: "done" });
    await channel.start();
    api.push(textUpdate(1, "long"));
    await vi.waitFor(() => expect(api.sent.length).toBeGreaterThan(1));
    expect(api.sent.every((message) => message.text.length <= MESSAGE_LIMIT)).toBe(true);
  });

  test("messages beyond the queue wait for the turn and are refused", async () => {
    const { api, gateway, channel } = setup();
    const release = Promise.withResolvers<void>();
    gateway.handler = async () => {
      await release.promise;
      return { text: "ok", status: "done" };
    };
    await channel.start();
    for (let i = 1; i <= MAX_QUEUED_MESSAGES + 3; i++) api.push(textUpdate(i, `m${i}`));
    await vi.waitFor(() => expect(api.texts).toContain("channels.zalo.busy"));
    release.resolve();
    await vi.waitFor(() => expect(gateway.turns.length).toBe(MAX_QUEUED_MESSAGES + 1));
  });
});

describe("pairing", () => {
  test("a stranger is told how to start and can pair with the open code", async () => {
    const { api, channel, pairing, paired } = setup(null);
    await channel.start();
    api.push(textUpdate(1, "/start"));
    await vi.waitFor(() => expect(api.texts).toEqual(["channels.zalo.start"]));

    api.push(textUpdate(2, "/pair ABC"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toBe("channels.zalo.pairInvalid"));

    const { code } = pairing.open(Date.now());
    api.push(textUpdate(3, `/pair ${code}`));
    await vi.waitFor(() => expect(paired).toEqual([{ id: "u7", name: "Ann" }]));
    expect(api.texts.at(-1)).toContain("channels.zalo.pairSuccess");
  });

  test("a stranger cannot pair when an owner exists and no pairing is open", async () => {
    const { api, channel, paired } = setup();
    await channel.start();
    api.push(textUpdate(1, "/pair ABCDEFGH", "u99"));
    api.push(textUpdate(2, "ping"));
    await vi.waitFor(() => expect(api.texts).toEqual(["ok"]));
    expect(paired).toEqual([]);
  });
});

describe("commands", () => {
  test("/new starts a conversation and /stop aborts the turn", async () => {
    const { api, gateway, channel } = setup();
    await channel.start();
    api.push(textUpdate(1, "/new"));
    await vi.waitFor(() => expect(api.texts).toEqual(["channels.zalo.newConversation"]));
    expect(gateway.fresh).toEqual(["zalo:u7"]);
    api.push(textUpdate(2, "/stop"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toBe("channels.zalo.stopped"));
    expect(gateway.aborted).toContain("zalo:u7");
  });

  test("/agent lists numbered choices, and /agent 2 or a name switches", async () => {
    const { api, gateway, channel } = setup();
    await channel.start();
    api.push(textUpdate(1, "/agent"));
    await vi.waitFor(() => expect(api.texts.length).toBe(1));
    expect(api.texts[0]).toContain("1. 🤖 PP Agent ✓");
    expect(api.texts[0]).toContain("2. 💰 Finance");

    api.push(textUpdate(2, "/agent 2"));
    api.push(textUpdate(3, "/agent hr"));
    await vi.waitFor(() => expect(gateway.chosen.length).toBe(2));
    expect(gateway.chosen).toEqual([
      { chatKey: "zalo:u7", agentId: "agent-finance" },
      { chatKey: "zalo:u7", agentId: "agent-hr" },
    ]);
  });

  test("/model picks for this conversation only", async () => {
    const { api, gateway, channel } = setup();
    await channel.start();
    api.push(textUpdate(1, "/model 3"));
    await vi.waitFor(() => expect(gateway.picked.length).toBe(1));
    expect(gateway.picked[0]).toEqual({ chatKey: "zalo:u7", kind: "model", id: "m3" });
  });

  test("/sessions lists and /resume switches", async () => {
    const { api, gateway, channel } = setup();
    gateway.sessions = [
      { id: "a", title: "Now", isCurrent: true },
      { id: "b", title: "Before", isCurrent: false },
    ];
    await channel.start();
    api.push(textUpdate(1, "/sessions"));
    await vi.waitFor(() => expect(api.texts).toEqual(["1. Now ←\n2. Before"]));
    api.push(textUpdate(2, "/resume 2"));
    await vi.waitFor(() =>
      expect(gateway.resumed).toEqual([{ chatKey: "zalo:u7", sessionId: "b" }]),
    );
  });
});

describe("attachments", () => {
  test("a photo is downloaded and sent as an image with its caption", async () => {
    const { api, gateway, channel } = setup();
    api.files.set("https://cdn/p", { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" });
    await channel.start();
    api.push(
      media(
        { message_type: "CHAT_PHOTO", photo_url: "https://cdn/p", caption: "What is this?" },
        "message.image.received",
      ),
    );
    await vi.waitFor(() => expect(gateway.turns.length).toBe(1));
    expect(gateway.turns[0]?.input).toEqual({
      text: "What is this?",
      attachments: [{ name: "photo.png", mimeType: "image/png", data: "AQID" }],
    });
  });

  test("a voice note is transcribed", async () => {
    const { api, gateway, channel } = setup();
    api.files.set("https://cdn/v", { data: new Uint8Array(4), mimeType: "audio/aac" });
    await channel.start();
    api.push(media({ voice_url: "https://cdn/v" }, "message.voice.received"));
    await vi.waitFor(() => expect(gateway.turns.length).toBe(1));
    expect(gateway.transcripts).toEqual([{ size: 4, mimeType: "audio/aac" }]);
    expect(gateway.turns[0]?.input.text).toBe("spoken words");
  });

  test("a download failure and a sticker are answered, not run", async () => {
    const { api, gateway, channel } = setup();
    api.downloadError = new ZaloApiError("too_large", "big");
    await channel.start();
    api.push(media({ photo_url: "https://cdn/p" }, "message.image.received"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toContain("channels.zalo.fileTooLarge"));
    api.push(media({ message_type: "CHAT_STICKER" }, "message.sticker.received"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toBe("channels.zalo.unsupported"));
    expect(gateway.turns).toEqual([]);
  });
});

describe("approvals and questions by reply", () => {
  test("the owner approves with 1 and denies with 2; other words ask again", async () => {
    const { api, gateway, channel } = setup();
    const decisions: boolean[] = [];
    gateway.handler = async (_input, hooks) => {
      decisions.push(await hooks.askApproval(approvalRequest("a")));
      decisions.push(await hooks.askApproval(approvalRequest("b")));
      return { text: "done", status: "done" };
    };
    await channel.start();
    api.push(textUpdate(1, "go"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toContain("channels.zalo.approvalHint"));
    api.push(textUpdate(2, "maybe"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toBe("channels.zalo.answerRetry"));
    api.push(textUpdate(3, "1"));
    await vi.waitFor(() => expect(decisions).toEqual([true]));
    await vi.waitFor(() =>
      expect(api.texts.filter((t) => t.includes("approvalHint")).length).toBe(2),
    );
    api.push(textUpdate(4, "2"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toBe("done"));
    expect(decisions).toEqual([true, false]);
    // The replies answered the questions; they did not start turns of their own.
    expect(gateway.turns.length).toBe(1);
  });

  test("questions take a number, several numbers, own words, or a skip", async () => {
    const { api, gateway, channel } = setup();
    let answers: unknown;
    gateway.handler = async (_input, hooks) => {
      answers = await hooks.askQuestion(questionRequest());
      return { text: "done", status: "done" };
    };
    await channel.start();
    api.push(textUpdate(1, "go"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toContain("Which <period>?"));
    expect(api.texts.at(-1)).toContain("2. Q4 channels.zalo.questionRecommended");
    api.push(textUpdate(2, "9"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toBe("channels.zalo.answerRetry"));
    api.push(textUpdate(3, "2"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toContain("Which formats?"));
    api.push(textUpdate(4, "1, 2"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toBe("done"));
    expect(answers).toEqual([
      { id: "scope", selected: ["Q4"] },
      { id: "formats", selected: ["PDF", "Excel"] },
    ]);
  });

  test("own words answer a question and 0 skips it", async () => {
    const { api, gateway, channel } = setup();
    const results: unknown[] = [];
    gateway.handler = async (_input, hooks) => {
      results.push(await hooks.askQuestion(questionRequest()));
      results.push(await hooks.askQuestion(questionRequest("q2")));
      return { text: "done", status: "done" };
    };
    await channel.start();
    api.push(textUpdate(1, "go"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toContain("Which <period>?"));
    api.push(textUpdate(2, "the whole decade"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toContain("Which formats?"));
    api.push(textUpdate(3, "pdf only"));
    await vi.waitFor(() => expect(results.length).toBe(1));
    await vi.waitFor(() => expect(api.texts.at(-1)).toContain("Which <period>?"));
    api.push(textUpdate(4, "0"));
    await vi.waitFor(() => expect(results.length).toBe(2));
    expect(results[0]).toEqual([
      { id: "scope", selected: [], custom: "the whole decade" },
      { id: "formats", selected: [], custom: "pdf only" },
    ]);
    expect(results[1]).toBeNull();
  });

  test("/stop denies an open approval", async () => {
    const { api, gateway, channel } = setup();
    let decision: boolean | undefined;
    gateway.handler = async (_input, hooks) => {
      decision = await hooks.askApproval(approvalRequest());
      return { text: "", status: "aborted" };
    };
    await channel.start();
    api.push(textUpdate(1, "go"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toContain("approvalHint"));
    api.push(textUpdate(2, "/stop"));
    await vi.waitFor(() => expect(decision).toBe(false));
  });
});

describe("failures", () => {
  test("a failed turn is reported", async () => {
    const { api, gateway, channel } = setup();
    gateway.handler = async () => ({ text: "", status: "error", error: "boom" });
    await channel.start();
    api.push(textUpdate(1, "x"));
    await vi.waitFor(() =>
      expect(api.texts).toEqual(['channels.zalo.turnFailed {"error":"boom"}']),
    );
  });

  test("a message that cannot be sent is logged, not thrown", async () => {
    const { api, gateway, channel } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.sendError = () => new ZaloApiError("api", "nope");
    gateway.handler = async () => ({ text: "answer", status: "done" });
    await channel.start();
    api.push(textUpdate(1, "x"));
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});
