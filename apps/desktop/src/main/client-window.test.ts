import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  session: { fromPartition: () => ({}) },
  shell: { openExternal: vi.fn() },
}));
vi.mock("./i18n.ts", () => ({ translator: () => (key: string) => key }));

const { clientPageUrl, probeClient, readClientTarget } = await import("./client-window.ts");

const COMPUTER = "http://10.0.0.5:47830";

describe("readClientTarget", () => {
  it("reads an address, adding Remote access's port", () => {
    expect(readClientTarget("  10.0.0.5  ")).toEqual({ server: COMPUTER, code: null });
    expect(readClientTarget("10.0.0.5:47831")).toEqual({
      server: "http://10.0.0.5:47831",
      code: null,
    });
  });

  it("keeps the pairing code from the QR link", () => {
    expect(readClientTarget(`${COMPUTER}/#pair=AB12CD34`)).toEqual({
      server: COMPUTER,
      code: "AB12CD34",
    });
  });

  it("refuses what is not an address", () => {
    expect(() => readClientTarget("not an address!!")).toThrow("client.badAddress");
    expect(() => readClientTarget("ftp://10.0.0.5")).toThrow("client.badAddress");
  });

  it("requires HTTPS outside the person's network", () => {
    expect(() => readClientTarget("http://agent.example.com:47830")).toThrow(
      "client.httpsRequired",
    );
    expect(readClientTarget("https://agent.example.com").server).toBe("https://agent.example.com");
  });
});

describe("clientPageUrl", () => {
  it("opens the address, with the pairing code in the fragment the page reads", () => {
    expect(clientPageUrl({ server: COMPUTER, code: null })).toBe(`${COMPUTER}/`);
    expect(clientPageUrl({ server: COMPUTER, code: "AB12CD34" })).toBe(
      `${COMPUTER}/#pair=AB12CD34`,
    );
  });
});

describe("probeClient", () => {
  it("asks the other computer for its session", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ paired: false }) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(probeClient(COMPUTER)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`${COMPUTER}/api/session`, expect.anything());
    vi.unstubAllGlobals();
  });

  it("names a computer it cannot reach", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    await expect(probeClient(COMPUTER)).rejects.toThrow("client.unreachable");
    vi.unstubAllGlobals();
  });

  it("refuses an answer that is not PP Agent", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ hello: "world" }) }));
    await expect(probeClient(COMPUTER)).rejects.toThrow("client.notPpAgent");
    vi.unstubAllGlobals();
  });
});
