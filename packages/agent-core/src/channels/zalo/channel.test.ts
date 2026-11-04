import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { ChannelState, ZaloChatSettings } from "@workspace/shared";
import { PairingGuard } from "../shared/pairing.ts";
import { FakeGateway, approvalRequest, questionRequest } from "../shared/testing.ts";
import { ZaloApiError, type ZaloUpdate } from "./api.ts";
import { MAX_QUEUED_MESSAGES, MESSAGE_LIMIT, ZaloChannel, type ZaloOwner } from "./channel.ts";
import { FakeZaloApi, fakeT, textUpdate } from "./testing.ts";

const OWNER: ZaloOwner = { id: "u7", name: "Ann" };
const channels: ZaloChannel[] = [];

function setup(initialOwner: ZaloOwner | null = OWNER, chats?: Record<string, ZaloChatSettings>) {
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
    settings: { get: () => ({ channels: { zalo: { chats } } }) },
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

  test("strangers, bots and repeats are ignored", async () => {
    const { api, gateway, channel } = setup();
    await channel.start();
    api.push(textUpdate(1, "hello", "u99"));
    const bot = textUpdate(2, "hello");
    bot.message!.from!.is_bot = true;
    api.push(bot);
    api.push(textUpdate(3, "once"));
    api.push(textUpdate(3, "once"));
    await vi.waitFor(() => expect(api.texts).toEqual(["ok"]));
    expect(gateway.turns.map((turn) => turn.input.text)).toEqual(["once"]);
  });

  test("the owner's mention or reply in a group becomes a turn, answered to the group", async () => {
    const { api, gateway, channel } = setup();
    gateway.handler = async () => ({ text: "Hello group", status: "done" });
    await channel.start();
    api.push(textUpdate(1, "@bot hi", "u7", "GROUP"));
    await vi.waitFor(() => expect(api.texts).toEqual(["Hello group"]));
    expect(gateway.turns[0]?.chatKey).toBe("zalo:g1");
    expect(api.sent[0]?.chatId).toBe("g1");
  });

  test("a non-owner's message in a group is ignored", async () => {
    const { api, gateway, channel } = setup();
    await channel.start();
    api.push(textUpdate(1, "@bot hi", "u99", "GROUP"));
    api.push(textUpdate(2, "once"));
    await vi.waitFor(() => expect(api.texts).toEqual(["ok"]));
    expect(gateway.turns.map((turn) => turn.input.text)).toEqual(["once"]);
  });

  test("a member allowed in a configured group's allowlist becomes a turn", async () => {
    const { api, gateway, channel } = setup(OWNER, {
      g1: { access: "members", allowedUsers: ["u8"] },
    });
    gateway.handler = async () => ({ text: "done", status: "done" });
    await channel.start();
    api.push(textUpdate(1, "@bot hi", "u8", "GROUP"));
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(1));
    api.push(textUpdate(2, "@bot again", "u9", "GROUP"));
    api.push(textUpdate(3, "once"));
    await vi.waitFor(() => expect(api.texts).toEqual(["done", "done"]));
    expect(gateway.turns).toHaveLength(2);
    expect(gateway.turns[0]?.chatKey).toBe("zalo:g1");
  });

  test("an empty allowlist with members access lets anyone in the configured group talk", async () => {
    const { api, gateway, channel } = setup(OWNER, { g1: { access: "members" } });
    gateway.handler = async () => ({ text: "done", status: "done" });
    await channel.start();
    api.push(textUpdate(1, "@bot hi", "u8", "GROUP"));
    await vi.waitFor(() => expect(api.texts).toContain("done"));
    expect(gateway.turns).toHaveLength(1);
  });

  test("a configured members group cannot use or consume a pairing code", async () => {
    const { api, channel, pairing, paired } = setup(null, { g1: { access: "members" } });
    const { code } = pairing.open(Date.now());
    await channel.start();
    api.push(textUpdate(1, `/pair ${code}`, "u8", "GROUP"));
    api.push(textUpdate(2, `/pair ${code}`, "u8"));
    await vi.waitFor(() => expect(paired).toHaveLength(1));
    expect(paired[0]?.id).toBe("u8");
    expect(api.sent.map((sent) => sent.chatId)).toEqual(["u8"]);
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

  test("/id reports the private chat's id, and the owner's /id in an unconfigured group reports its id too", async () => {
    const { api, channel } = setup();
    await channel.start();
    api.push(textUpdate(1, "/id"));
    await vi.waitFor(() =>
      expect(api.texts).toContain('channels.zalo.idReply {"chatId":"u7","chatType":"private"}'),
    );
    api.push(textUpdate(2, "/id", "u7", "GROUP"));
    await vi.waitFor(() =>
      expect(api.texts).toContain('channels.zalo.idReply {"chatId":"g1","chatType":"group"}'),
    );
  });

  test("a non-owner's /id in a group is ignored", async () => {
    const { api, channel } = setup();
    await channel.start();
    api.push(textUpdate(1, "/id", "u99", "GROUP"));
    api.push(textUpdate(2, "/help"));
    await vi.waitFor(() => expect(api.texts).toContain("channels.zalo.help"));
    expect(api.texts.some((text) => text.includes("idReply"))).toBe(false);
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

  test("a permitted group member's reply cannot settle the owner's pending approval", async () => {
    const { api, gateway, channel } = setup(OWNER, {
      g1: { access: "members", allowedUsers: ["u8"] },
    });
    let decision: boolean | undefined;
    gateway.handler = async (_input, hooks) => {
      decision = await hooks.askApproval(approvalRequest());
      return { text: "done", status: "done" };
    };
    await channel.start();
    api.push(textUpdate(1, "@bot go", "u7", "GROUP"));
    await vi.waitFor(() => expect(api.texts.at(-1)).toContain("channels.zalo.approvalHint"));
    // "gibberish" answers neither yes nor no. If a member's reply reached the open prompt, it
    // would be consumed there (an "answerRetry" reply, never a turn); the fix must instead queue
    // it as a turn of its own, behind the one the approval belongs to. Only the owner's "1" may
    // settle the approval, which is what lets the queue drain and that turn run.
    api.push(textUpdate(2, "gibberish", "u8", "GROUP"));
    api.push(textUpdate(3, "1", "u7", "GROUP"));
    await vi.waitFor(() => expect(decision).toBe(true));
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(2));
    expect(gateway.turns.map((turn) => turn.input.text)).toEqual(["@bot go", "gibberish"]);
    expect(api.texts).not.toContain("channels.zalo.answerRetry");
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

describe("binding command authorization", () => {
  test("a permitted group member cannot change bindings", async () => {
    const chats = { g1: { access: "members" as const, allowedUsers: ["u8"] } };
    const { api, gateway, channel } = setup(OWNER, chats);
    await channel.start();
    api.push(textUpdate(1, "/agent", "u8", "GROUP"));
    api.push(textUpdate(2, "/agent 2", "u8", "GROUP"));
    api.push(textUpdate(3, "/help", "u8", "GROUP"));
    await vi.waitFor(() => expect(api.texts).toContain("channels.zalo.help"));
    expect(gateway.chosen).toEqual([]);
    expect(gateway.turns).toEqual([]);
  });

  test("a permitted private-chat member cannot change bindings either", async () => {
    const { api, gateway, channel } = setup(OWNER, { u8: { access: "members" } });
    await channel.start();
    for (const [index, name] of ["agent", "workspace", "model", "thinking", "effort"].entries()) {
      api.push(textUpdate(index * 2 + 1, `/${name}`, "u8"));
      api.push(textUpdate(index * 2 + 2, `/${name} 2`, "u8"));
    }
    api.push(textUpdate(11, "/help", "u8"));
    await vi.waitFor(() => expect(api.texts).toContain("channels.zalo.help"));
    expect(gateway.chosen).toEqual([]);
    expect(gateway.picked).toEqual([]);
    expect(gateway.turns).toEqual([]);
  });
});

describe("busy mode", () => {
  test("steers plain text only after the active turn accepts it", async () => {
    const { api, channel, gateway } = setup(OWNER, { u7: { busyMode: "steer" } });
    const gate = Promise.withResolvers<void>();
    gateway.handler = async () => {
      await gate.promise;
      return { text: "done", status: "done" };
    };
    gateway.steerHandler = async () => true;
    await channel.start();
    api.push(textUpdate(1, "first"));
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(1));
    api.push(textUpdate(2, "  correction  "));
    await vi.waitFor(() => expect(gateway.steered).toHaveLength(1));
    expect(gateway.steered[0]).toEqual({
      chatKey: "zalo:u7",
      input: { text: "correction", attachments: [] },
    });
    gate.resolve();
    await vi.waitFor(() => expect(api.texts).toContain("done"));
    expect(gateway.turns).toHaveLength(1);
  });

  test.each(["declined", "error"] as const)(
    "queues plain text when steering is %s",
    async (outcome) => {
      const { api, channel, gateway } = setup(OWNER, { u7: { busyMode: "steer" } });
      const gate = Promise.withResolvers<void>();
      gateway.handler = async () => {
        await gate.promise;
        return { text: "done", status: "done" };
      };
      gateway.steerHandler = async () => {
        if (outcome === "error") throw new Error("steering failed");
        return false;
      };
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      await channel.start();
      api.push(textUpdate(1, "first"));
      await vi.waitFor(() => expect(gateway.turns).toHaveLength(1));
      api.push(textUpdate(2, "correction"));
      await vi.waitFor(() => expect(gateway.steered).toHaveLength(1));
      gate.resolve();
      await vi.waitFor(() => expect(gateway.turns).toHaveLength(2));
      expect(gateway.turns[1]?.input).toEqual({ text: "correction", attachments: [] });
      if (outcome === "error")
        expect(warning).toHaveBeenCalledWith(
          "[zalo] Could not steer the turn; queueing the message:",
          expect.any(Error),
        );
      warning.mockRestore();
    },
  );

  test("interrupt mode aborts the running turn before queueing the next message", async () => {
    const { api, channel, gateway } = setup(OWNER, { u7: { busyMode: "interrupt" } });
    const gate = Promise.withResolvers<void>();
    gateway.handler = async () => {
      await gate.promise;
      return { text: "done", status: "done" };
    };
    await channel.start();
    api.push(textUpdate(1, "first"));
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(1));
    api.push(textUpdate(2, "second"));
    await vi.waitFor(() => expect(gateway.aborted).toContain("zalo:u7"));
    gate.resolve();
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(2));
  });
});
