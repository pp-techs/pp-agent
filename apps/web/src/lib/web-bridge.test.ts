import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { checkSession, connectToServer, forgetServer, useWebSession } from "./web-bridge";

// The phone app's flow: requests go to the computer the person connected to.
vi.mock("@/lib/native", () => ({ isNativeApp: true, shareTextFile: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
// The test runner does not resolve the `@/` alias; point it at the real module.
vi.mock("@/lib/server-address", () => import("./server-address"));

interface PendingFetch {
  url: string;
  resolve: (response: unknown) => void;
  reject: (error: unknown) => void;
}

let calls: PendingFetch[];

/** A fetch answer whose body is `body`, or arrives when that promise resolves. */
function answer(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

async function nextCall(index: number): Promise<PendingFetch> {
  for (let tries = 0; tries < 50 && calls.length <= index; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const call = calls[index];
  if (!call) throw new Error(`no fetch #${index}`);
  return call;
}

const COMPUTER = "http://10.0.0.5:47830";
const UNPAIRED = { paired: false, deviceName: null, appVersion: "1.0.0" };

/** The WebView's storage, which the bridge keeps the computer and the device token in. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  calls = [];
  vi.stubGlobal(
    "fetch",
    (url: string) =>
      new Promise((resolve, reject) => {
        calls.push({ url, resolve, reject });
      }),
  );
  forgetServer();
});

describe("session checks in the phone app", () => {
  it("ignore an answer that arrives after the computer was forgotten", async () => {
    const connecting = connectToServer(COMPUTER, null);
    (await nextCall(0)).resolve(answer(UNPAIRED));
    const check = await nextCall(1);
    expect(check.url).toBe(`${COMPUTER}/api/session`);
    // The body is still on its way when the person picks another computer.
    let arrive: (body: unknown) => void = () => undefined;
    const late = new Promise((resolve) => (arrive = resolve));
    check.resolve(answer(late));
    await new Promise((resolve) => setTimeout(resolve, 0));
    forgetServer();
    arrive({ paired: true, deviceName: "Old", appVersion: "1.0.0" });
    await connecting;

    expect(useWebSession.getState()).toMatchObject({ phase: "noComputer", server: null });
  });

  it("let a newer check win after leaving and reconnecting to the same computer", async () => {
    const first = connectToServer(COMPUTER, null);
    (await nextCall(0)).resolve(answer(UNPAIRED));
    (await nextCall(1)).resolve(answer(UNPAIRED));
    await first;
    expect(useWebSession.getState().phase).toBe("unpaired");

    // An older check is still waiting when the person leaves and comes back.
    const stale = checkSession();
    const staleCall = await nextCall(2);
    forgetServer();
    const again = connectToServer(COMPUTER, null);
    (await nextCall(3)).resolve(answer(UNPAIRED));
    (await nextCall(4)).resolve(answer(UNPAIRED));
    await again;
    staleCall.reject(new TypeError("Load failed"));
    await stale;

    expect(useWebSession.getState()).toMatchObject({ phase: "unpaired", server: COMPUTER });
  });

  it("forget a saved public HTTP address instead of sending the token there", async () => {
    // Saved by an older version, with its token.
    localStorage.setItem("pp-agent.server", "http://agent.example.com:47830");
    localStorage.setItem("pp-agent.device-token", "device.secret");
    await checkSession();

    expect(calls).toHaveLength(0);
    expect(useWebSession.getState()).toMatchObject({ phase: "noComputer", server: null });
    expect(localStorage.getItem("pp-agent.server")).toBeNull();
    expect(localStorage.getItem("pp-agent.device-token")).toBeNull();
  });
});
