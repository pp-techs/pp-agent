import { existsSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { ChannelState } from "@workspace/shared";
import { TelegramApiError, type TelegramMessage, type TelegramUpdate } from "./api.ts";
import { MAX_QUEUED_MESSAGES, TelegramChannel, type TelegramOwner } from "./channel.ts";
import { PairingGuard } from "./pairing.ts";
import { approvalRequest, FakeApi, FakeGateway, fakeT, textUpdate } from "./testing.ts";

const OWNER: TelegramOwner = { id: 7, name: "Ann Lee" };
const channels: TelegramChannel[] = [];

function setup(initialOwner: TelegramOwner | null = OWNER) {
  const api = new FakeApi();
  const gateway = new FakeGateway();
  const pairing = new PairingGuard();
  const state = { owner: initialOwner };
  const paired: TelegramOwner[] = [];
  const states: [ChannelState, string | null][] = [];
  const channel = new TelegramChannel({
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

/** The latest text of every message the bot sent or edited, in send order. */
function shown(api: FakeApi): string[] {
  const latest = new Map<number, string>();
  for (const message of api.sent) latest.set(message.id, message.text);
  for (const edit of api.edits) latest.set(edit.messageId, edit.text);
  return [...latest.values()];
}

function message(extra: Partial<TelegramMessage>, id = 1, from = 7): TelegramUpdate {
  return {
    update_id: id,
    message: {
      message_id: id,
      chat: { id: from, type: "private" },
      from: { id: from, first_name: "Ann" },
      ...extra,
    },
  };
}

afterEach(async () => {
  await Promise.all(channels.splice(0).map((channel) => channel.stop()));
  vi.useRealTimers();
});

describe("start and stop", () => {
  test("goes online, removes the webhook and reports the username", async () => {
    const { api, channel, states } = setup();
    expect(await channel.start()).toBe("pp_bot");
    expect(api.webhookDeleted).toBe(1);
    expect(states).toEqual([
      ["connecting", null],
      ["online", null],
    ]);
    await channel.stop();
    expect(states.at(-1)).toEqual(["off", null]);
  });

  test("publishes the command menu on connect, and a failure does not stop the bot", async () => {
    const first = setup();
    await first.channel.start();
    expect(first.api.commands.map((entry) => entry.command)).toEqual([
      "new",
      "agent",
      "workspace",
      "model",
      "thinking",
      "stop",
      "help",
    ]);
    expect(first.api.commands.every((entry) => entry.description.length > 0)).toBe(true);

    const second = setup();
    second.api.setCommandsError = new Error("nope");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await second.channel.start()).toBe("pp_bot");
    expect(second.states.at(-1)).toEqual(["online", null]);
  });

  test("a refused token is an error state and nothing polls", async () => {
    const { api, channel, states } = setup();
    api.getMeError = new TelegramApiError("unauthorized", "Unauthorized", 401);
    expect(await channel.start()).toBeNull();
    expect(states.at(-1)).toEqual(["error", "channels.telegram.tokenInvalid"]);
    expect(api.offsets).toEqual([]);
  });

  test("keeps retrying when Telegram cannot be reached", async () => {
    vi.useFakeTimers();
    const { api, channel, states } = setup();
    api.getMeError = new TelegramApiError("network", "fetch failed");
    expect(await channel.start()).toBeNull();
    expect(states.at(-1)?.[0]).toBe("error");
    api.getMeError = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toEqual(["online", null]);
    expect(api.offsets).toEqual([0]);
  });

  test("reports a second poller as a conflict and recovers", async () => {
    vi.useFakeTimers();
    const { api, channel, states } = setup();
    const original = api.getUpdates.bind(api);
    let calls = 0;
    api.getUpdates = async (offset, signal) => {
      if (calls++ === 0) throw new TelegramApiError("conflict", "Conflict", 409);
      return original(offset, signal);
    };
    await channel.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual(["error", "channels.telegram.conflict"]);
    api.push(textUpdate(1, "/help"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toEqual(["online", null]);
  });

  test("acknowledges updates by advancing the offset", async () => {
    const { api, channel } = setup();
    await channel.start();
    api.push(textUpdate(41, "/help"));
    await vi.waitFor(() => expect(api.offsets.at(-1)).toBe(42));
  });
});

describe("pairing", () => {
  test("without an owner only /pair and /start are answered", async () => {
    const { api, channel, gateway } = setup(null);
    await channel.start();
    api.push(textUpdate(1, "hello"));
    api.push(textUpdate(2, "/new"));
    api.push(textUpdate(3, "/start"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]?.text).toBe("channels.telegram.start");
    expect(gateway.turns).toHaveLength(0);
    expect(gateway.fresh).toHaveLength(0);
  });

  test("a valid code pairs the sender", async () => {
    const { api, channel, pairing, paired } = setup(null);
    await channel.start();
    const { code } = pairing.open(Date.now());
    api.push(textUpdate(1, "/pair WRONG123"));
    api.push(textUpdate(2, "/pair"));
    api.push(textUpdate(3, `/pair ${code}`));
    await vi.waitFor(() => expect(api.sent).toHaveLength(3));
    expect(api.plainTexts).toEqual([
      "channels.telegram.pairInvalid",
      "channels.telegram.pairUsage",
      'channels.telegram.pairSuccess {"name":"Ann Lee"}',
    ]);
    expect(paired).toEqual([{ id: 7, name: "Ann Lee" }]);
  });

  test("answers that no pairing is open as an invalid code", async () => {
    const { api, channel, paired } = setup(null);
    await channel.start();
    api.push(textUpdate(1, "/pair ABCDEFGH"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]?.text).toBe("channels.telegram.pairInvalid");
    expect(paired).toEqual([]);
  });

  test("after five wrong codes the bot says to wait", async () => {
    const { api, channel, pairing } = setup(null);
    await channel.start();
    pairing.open(Date.now());
    for (let i = 1; i <= 5; i++) api.push(textUpdate(i, "/pair WRONG123"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(5));
    expect(api.sent[4]?.text).toContain('channels.telegram.pairLocked {"minutes":15}');
  });

  test("an owner is told they are already paired", async () => {
    const { api, channel } = setup();
    await channel.start();
    api.push(textUpdate(1, "/pair CODE1234"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]?.text).toBe("channels.telegram.alreadyPaired");
  });

  test("with an owner, strangers are ignored unless a pairing is open", async () => {
    const { api, channel, pairing, paired } = setup();
    await channel.start();
    api.push(textUpdate(1, "hello", 8));
    api.push(textUpdate(2, "/start", 8));
    api.push(textUpdate(3, "/pair ABCDEFGH", 8));
    api.push(textUpdate(4, "/help", 7));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]?.chatId).toBe(7);

    const { code } = pairing.open(Date.now());
    api.push(textUpdate(5, `/pair ${code}`, 8));
    await vi.waitFor(() => expect(paired).toHaveLength(1));
    expect(paired[0]?.id).toBe(8);
  });
});

describe("messages", () => {
  test("ignores groups and bots", async () => {
    const { api, channel, gateway } = setup();
    await channel.start();
    api.push(textUpdate(1, "hello", 7, "group"));
    api.push({
      update_id: 2,
      message: {
        message_id: 2,
        chat: { id: 7, type: "private" },
        from: { id: 7, is_bot: true, first_name: "B" },
        text: "hi",
      },
    });
    api.push(textUpdate(3, "/help"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(gateway.turns).toHaveLength(0);
  });

  test("runs a text turn and shows the final answer", async () => {
    const { api, channel, gateway } = setup();
    gateway.handler = async (_, hooks) => {
      hooks.onTool("Reading file");
      hooks.onText("par");
      return { text: "**final** answer", status: "done" };
    };
    await channel.start();
    api.push(textUpdate(1, "what is up"));
    await vi.waitFor(() => expect(shown(api)).toContain("<b>final</b> answer"));
    expect(gateway.turns[0]?.chatKey).toBe("telegram:7");
    expect(gateway.turns[0]?.input).toEqual({ text: "what is up", attachments: [] });
    expect(api.actions.length).toBeGreaterThan(0);
  });

  test("passes unknown slash commands to the agent", async () => {
    const { api, channel, gateway } = setup();
    await channel.start();
    api.push(textUpdate(1, "/etc/hosts please"));
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(1));
    expect(gateway.turns[0]?.input.text).toBe("/etc/hosts please");
  });

  test("a photo becomes a base64 image attachment with its caption as text", async () => {
    const { api, channel, gateway } = setup();
    api.files.set("big", new Uint8Array([1, 2, 3]));
    await channel.start();
    api.push(
      message({
        caption: "look",
        photo: [
          { file_id: "small", width: 10, height: 10, file_size: 10 },
          { file_id: "big", width: 100, height: 100, file_size: 300 },
        ],
      }),
    );
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(1));
    expect(gateway.turns[0]?.input).toEqual({
      text: "look",
      attachments: [{ name: "photo.jpg", mimeType: "image/jpeg", data: "AQID" }],
    });
  });

  test("a document is saved under a sanitized unique name and deleted after the turn", async () => {
    const { api, channel, gateway } = setup();
    api.files.set("doc", new Uint8Array([9, 9]));
    let seen: string | undefined;
    gateway.handler = async (input) => {
      seen = input.attachments[0]?.path;
      return { text: "read it", status: "done" };
    };
    await channel.start();
    api.push(
      message({
        document: { file_id: "doc", file_name: "../../etc/pa ss<wd>.txt", mime_type: "text/plain" },
      }),
    );
    await vi.waitFor(() => expect(shown(api)).toContain("read it"));
    const attachment = gateway.turns[0]?.input.attachments[0];
    expect(attachment?.mimeType).toBe("text/plain");
    expect(attachment?.name).toBe("pa ss_wd_.txt");
    expect(seen).toContain("pp-agent-telegram");
    expect(seen?.endsWith("-pa ss_wd_.txt")).toBe(true);
    await vi.waitFor(() => expect(existsSync(seen!)).toBe(false));
  });

  test("a file that is too large is reported", async () => {
    const { api, channel, gateway } = setup();
    api.downloadError = new TelegramApiError("too_large", "The file is too large.");
    await channel.start();
    api.push(message({ document: { file_id: "doc", file_name: "a.bin" } }));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]?.text).toBe('channels.telegram.fileTooLarge {"max":20}');
    expect(gateway.turns).toHaveLength(0);
  });

  test("a voice message is transcribed and the words become the message", async () => {
    const { api, channel, gateway } = setup();
    api.files.set("v", new Uint8Array([1, 2]));
    gateway.transcript = "play some music";
    await channel.start();
    api.push(message({ voice: { file_id: "v", mime_type: "audio/ogg" } }));
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(1));
    expect(gateway.transcripts).toEqual([{ size: 2, mimeType: "audio/ogg" }]);
    expect(gateway.turns[0]?.input.text).toBe("play some music");
  });

  test("tells the person when transcription fails", async () => {
    const { api, channel, gateway } = setup();
    api.files.set("v", new Uint8Array([1]));
    gateway.transcript = new Error("Voice input is not set up.");
    await channel.start();
    api.push(message({ audio: { file_id: "v" } }));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]?.text).toBe(
      'channels.telegram.transcribeFailed {"error":"Voice input is not set up."}',
    );
    expect(gateway.turns).toHaveLength(0);
  });

  test("answers kinds of message it cannot read", async () => {
    const { api, channel } = setup();
    await channel.start();
    api.push(message({}));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]?.text).toBe("channels.telegram.unsupported");
  });

  test("reports a failed turn and an empty answer in plain words", async () => {
    const { api, channel, gateway } = setup();
    await channel.start();
    gateway.handler = async () => ({ text: "", status: "error", error: "No model is set up." });
    api.push(textUpdate(1, "a"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]?.text).toBe('channels.telegram.turnFailed {"error":"No model is set up."}');

    gateway.handler = async () => ({ text: "  ", status: "done" });
    api.push(textUpdate(2, "b"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(2));
    expect(api.sent[1]?.text).toBe("channels.telegram.emptyAnswer");

    gateway.handler = async () => {
      throw new Error("boom");
    };
    api.push(textUpdate(3, "c"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(3));
    expect(api.sent[2]?.text).toBe('channels.telegram.turnFailed {"error":"boom"}');
  });

  test("an aborted turn adds nothing after the partial text", async () => {
    const { api, channel, gateway } = setup();
    gateway.handler = async () => ({ text: "", status: "aborted" });
    await channel.start();
    api.push(textUpdate(1, "a"));
    api.push(textUpdate(2, "/help"));
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(1));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]?.text).toBe("channels.telegram.help");
  });

  test("approval buttons settle the turn's question", async () => {
    const { api, channel, gateway } = setup();
    let approved: boolean | undefined;
    gateway.handler = async (_, hooks) => {
      approved = await hooks.askApproval(approvalRequest("r9"));
      return { text: approved ? "ran it" : "skipped", status: "done" };
    };
    await channel.start();
    api.push(textUpdate(1, "do it"));
    await vi.waitFor(() => expect(api.sent.some((m) => m.options?.replyMarkup)).toBe(true));
    api.push({
      update_id: 2,
      callback_query: { id: "c", from: { id: 7, first_name: "A" }, data: "ap:r9:1" },
    });
    await vi.waitFor(() => expect(shown(api)).toContain("ran it"));
    expect(approved).toBe(true);
  });
});

describe("queue and commands", () => {
  function blockedTurns(gateway: FakeGateway) {
    const gates: PromiseWithResolvers<void>[] = [];
    gateway.handler = async () => {
      const gate = Promise.withResolvers<void>();
      gates.push(gate);
      await gate.promise;
      return { text: "done", status: "done" };
    };
    return gates;
  }

  test("runs one turn at a time and answers busy beyond the queue limit", async () => {
    const { api, channel, gateway } = setup();
    const gates = blockedTurns(gateway);
    await channel.start();
    const total = MAX_QUEUED_MESSAGES + 2;
    for (let i = 1; i <= total; i++) api.push(textUpdate(i, `m${i}`));
    await vi.waitFor(() => expect(api.plainTexts).toContain("channels.telegram.busy"));
    expect(gateway.turns).toHaveLength(1);

    for (let i = 0; i < total - 1; i++) {
      await vi.waitFor(() => expect(gates).toHaveLength(i + 1));
      expect(gateway.turns.map((turn) => turn.input.text)).toEqual(
        Array.from({ length: i + 1 }, (_, n) => `m${n + 1}`),
      );
      gates[i]?.resolve();
    }
    await vi.waitFor(() => expect(gateway.turns).toHaveLength(total - 1));
  });

  test("/stop aborts the turn, drops the queue and denies pending questions", async () => {
    const { api, channel, gateway } = setup();
    const gates = blockedTurns(gateway);
    await channel.start();
    api.push(textUpdate(1, "first"));
    api.push(textUpdate(2, "second"));
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    api.push(textUpdate(3, "/stop"));
    await vi.waitFor(() => expect(api.plainTexts).toContain("channels.telegram.stopped"));
    expect(gateway.aborted).toEqual(["telegram:7"]);
    gates[0]?.resolve();
    await vi.waitFor(() => expect(shown(api)).toContain("done"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gateway.turns).toHaveLength(1);
  });

  test("/new starts a fresh conversation without waiting for the turn", async () => {
    const { api, channel, gateway } = setup();
    const gates = blockedTurns(gateway);
    await channel.start();
    api.push(textUpdate(1, "first"));
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    api.push(textUpdate(2, "/new"));
    await vi.waitFor(() => expect(api.plainTexts).toContain("channels.telegram.newConversation"));
    expect(gateway.fresh).toEqual(["telegram:7"]);
    gates[0]?.resolve();
  });

  test("/start and /help answer the owner", async () => {
    const { api, channel } = setup();
    await channel.start();
    api.push(textUpdate(1, "/start"));
    api.push(textUpdate(2, "/help@pp_bot"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(2));
    expect(api.plainTexts).toEqual([
      'channels.telegram.startPaired {"name":"Ann Lee"}',
      "channels.telegram.help",
    ]);
  });
});

describe("/agent and /workspace", () => {
  function tap(id: number, data: string, messageId: number, from = 7): TelegramUpdate {
    return {
      update_id: id,
      callback_query: {
        id: `cb${id}`,
        from: { id: from, first_name: "Ann" },
        data,
        message: { message_id: messageId, chat: { id: 7 } },
      },
    };
  }

  test("a name switches the agent, ignoring the icon and case", async () => {
    const { api, channel, gateway } = setup();
    await channel.start();
    api.push(textUpdate(1, "/agent finance"));
    await vi.waitFor(() => expect(api.plainTexts).toHaveLength(1));
    expect(gateway.chosen).toEqual([{ chatKey: "telegram:7", agentId: "agent-finance" }]);
    expect(api.plainTexts[0]).toBe('channels.telegram.agentChanged {"name":"💰 Finance"}');
  });

  test("a number or a unique part of the name works; an ambiguous one lists the choices", async () => {
    const { api, channel, gateway } = setup();
    await channel.start();
    api.push(textUpdate(1, "/agent 3"));
    api.push(textUpdate(2, "/workspace rep"));
    await vi.waitFor(() => expect(gateway.chosen).toHaveLength(2));
    expect(gateway.chosen).toEqual([
      { chatKey: "telegram:7", agentId: "agent-hr" },
      { chatKey: "telegram:7", workspaceId: "ws-reports" },
    ]);
    // "e" is in several names: nothing is switched, the list is shown instead.
    api.push(textUpdate(3, "/agent e"));
    await vi.waitFor(() => expect(api.sent.at(-1)?.options?.replyMarkup).toBeDefined());
    expect(gateway.chosen).toHaveLength(2);
    expect(api.sent.at(-1)?.text).toContain("agentNotFound");
  });

  test("without a name it offers buttons, marks the current one, and a tap switches", async () => {
    const { api, channel, gateway } = setup();
    await channel.start();
    api.push(textUpdate(1, "/agent"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    const offer = api.sent[0]!;
    expect(offer.text).toBe('channels.telegram.agentPrompt {"name":"🤖 PP Agent","query":""}');
    const buttons = offer.options!.replyMarkup!.inline_keyboard.map((row) => row[0]!);
    expect(buttons.map((button) => button.text)).toEqual([
      "✓ 🤖 PP Agent",
      "💰 Finance",
      "🧑‍💼 HR Helper",
    ]);
    expect(buttons.every((button) => button.callback_data.length <= 64)).toBe(true);

    api.push(tap(2, buttons[1]!.callback_data, offer.id));
    await vi.waitFor(() => expect(gateway.chosen).toHaveLength(1));
    expect(gateway.chosen[0]).toEqual({ chatKey: "telegram:7", agentId: "agent-finance" });
    await vi.waitFor(() => expect(api.edits).toHaveLength(1));
    expect(api.edits[0]?.text).toBe('channels.telegram.agentChanged {"name":"💰 Finance"}');
    expect(api.edits[0]?.options?.replyMarkup?.inline_keyboard).toEqual([]);
  });

  test("only the owner's tap counts, and a stale button is refused", async () => {
    const { api, channel, gateway } = setup();
    await channel.start();
    api.push(textUpdate(1, "/workspace"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    const data = api.sent[0]!.options!.replyMarkup!.inline_keyboard[1]![0]!.callback_data;
    api.push(tap(2, data, api.sent[0]!.id, 99));
    api.push(tap(3, data, 9999));
    await vi.waitFor(() => expect(api.answers).toHaveLength(2));
    expect(gateway.chosen).toEqual([]);
    expect(api.answers[1]?.text).toBe("channels.telegram.expired");
  });

  test("a failure is reported, and strangers get no answer", async () => {
    const { api, channel, gateway } = setup();
    await channel.start();
    gateway.chooseError = new Error("boom");
    api.push(textUpdate(1, "/agent hr"));
    await vi.waitFor(() => expect(api.plainTexts).toHaveLength(1));
    expect(api.plainTexts[0]).toBe('channels.telegram.turnFailed {"error":"boom"}');
    api.push(textUpdate(2, "/agent hr", 99));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.sent).toHaveLength(1);
  });
});

describe("/model and /thinking", () => {
  function tap(id: number, data: string, messageId: number): TelegramUpdate {
    return {
      update_id: id,
      callback_query: {
        id: `cb${id}`,
        from: { id: 7, first_name: "Ann" },
        data,
        message: { message_id: messageId, chat: { id: 7 } },
      },
    };
  }

  test("a name switches the model of this conversation, a tap on the list does too", async () => {
    const { api, channel, gateway } = setup();
    await channel.start();
    api.push(textUpdate(1, "/model sonnet"));
    await vi.waitFor(() => expect(gateway.picked).toHaveLength(1));
    expect(gateway.picked[0]).toEqual({ chatKey: "telegram:7", kind: "model", id: "m2" });
    expect(api.plainTexts[0]).toBe(
      'channels.telegram.modelChanged {"name":"Sonnet 5 · Anthropic"}',
    );

    api.push(textUpdate(2, "/model"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(2));
    const offer = api.sent[1]!;
    const buttons = offer.options!.replyMarkup!.inline_keyboard.map((row) => row[0]!);
    expect(buttons[0]?.text).toBe("✓ Opus 5.5 · Anthropic");
    api.push(tap(3, buttons[2]!.callback_data, offer.id));
    await vi.waitFor(() => expect(gateway.picked).toHaveLength(2));
    expect(gateway.picked[1]).toEqual({ chatKey: "telegram:7", kind: "model", id: "m3" });
  });

  test("/thinking and its alias /effort offer the levels the model has", async () => {
    const { api, channel, gateway } = setup();
    await channel.start();
    api.push(textUpdate(1, "/effort high"));
    await vi.waitFor(() => expect(gateway.picked).toHaveLength(1));
    expect(gateway.picked[0]).toEqual({ chatKey: "telegram:7", kind: "thinking", id: "high" });
    api.push(textUpdate(2, "/thinking"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(2));
    const labels = api.sent[1]!.options!.replyMarkup!.inline_keyboard.map((row) => row[0]!.text);
    expect(labels).toEqual(["off", "low", "✓ medium", "high"]);
  });

  test("a long list is cut to what fits and says how many are left", async () => {
    const { api, channel, gateway } = setup();
    gateway.picks.model = {
      options: Array.from({ length: 45 }, (_, index) => ({
        id: `m${index}`,
        label: `Model ${index}`,
      })),
      currentId: "m40",
    };
    await channel.start();
    api.push(textUpdate(1, "/model"));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]!.options!.replyMarkup!.inline_keyboard).toHaveLength(30);
    expect(api.sent[0]!.text).toContain('moreChoices {"count":15}');
  });

  test("with no levels to offer it says so, and a refusal from the chat is reported", async () => {
    const { api, channel, gateway } = setup();
    gateway.picks.thinking = { options: [], currentId: null };
    await channel.start();
    api.push(textUpdate(1, "/thinking"));
    await vi.waitFor(() => expect(api.plainTexts).toContain("channels.telegram.noChoices"));
    gateway.chooseError = new Error("Wait for the answer to finish.");
    api.push(textUpdate(2, "/model opus"));
    await vi.waitFor(() => expect(api.plainTexts).toHaveLength(2));
    expect(api.plainTexts[1]).toBe(
      'channels.telegram.turnFailed {"error":"Wait for the answer to finish."}',
    );
  });
});
