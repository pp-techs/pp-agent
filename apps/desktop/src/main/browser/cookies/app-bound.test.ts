import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * Windows Chrome/Edge/Brave encrypt cookies with a key ("app-bound") that only the browser itself
 * can unwrap. `readChromium` then asks the browser over CDP (`readCookiesThroughBrowser`); these
 * tests cover what happens when that ask cannot run or fails, so a person who picked hundreds of
 * sites sees why nothing was imported instead of a silent "0 cookies" success.
 */

const definition = {
  browser: "chrome" as const,
  win: "Google/Chrome/User Data",
  keychain: "Chrome Safe Storage",
  exe: "Google/Chrome/Application/chrome.exe",
};
const profile = { id: "Default", name: "Default" };

vi.mock("electron", () => ({ app: { getLocale: () => "en" } }));
vi.mock("../../i18n.ts", () => ({ translator: () => (key: string) => key }));

vi.mock("./chromium.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chromium.ts")>()),
  CHROMIUM_BROWSERS: [definition],
  userDataDir: () => "/fake/user-data",
  listChromiumProfiles: vi.fn().mockResolvedValue([profile]),
  cookieFile: () => "/fake/user-data/Default/Network/Cookies",
  readWindowsKey: vi.fn().mockResolvedValue(Buffer.alloc(32)),
  readMacPassword: vi.fn(),
  browserExecutable: vi.fn(),
}));

const readInBackground = vi.hoisted(() => vi.fn());
vi.mock("./reader-process.ts", () => ({ readInBackground }));

const readCookiesThroughBrowser = vi.hoisted(() => vi.fn());
vi.mock("./chromium-cdp.ts", () => ({ readCookiesThroughBrowser }));

const { readCookies } = await import("./index.ts");
const { browserExecutable } = await import("./chromium.ts");

beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "win32" });
  readInBackground.mockReset();
  readCookiesThroughBrowser.mockReset();
  vi.mocked(browserExecutable).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("app-bound cookies", () => {
  it("reports the browser bridge's failure instead of succeeding with nothing imported", async () => {
    readInBackground.mockResolvedValue({ cookies: [], unreadable: 0, appBound: 5 });
    vi.mocked(browserExecutable).mockReturnValue("C:\\chrome.exe");
    readCookiesThroughBrowser.mockRejectedValue(new Error("the browser exited"));

    await expect(readCookies("chrome", "Default", ["example.com"])).rejects.toThrow(
      "panel.cookies.appBoundFailed",
    );
  });

  it("reports that the browser could not be found when it has no executable to ask", async () => {
    readInBackground.mockResolvedValue({ cookies: [], unreadable: 0, appBound: 5 });
    vi.mocked(browserExecutable).mockReturnValue(null);

    await expect(readCookies("chrome", "Default", ["example.com"])).rejects.toThrow(
      "panel.cookies.appBoundNoBrowser",
    );
    expect(readCookiesThroughBrowser).not.toHaveBeenCalled();
  });

  it("still imports the cookies the browser hands back when the bridge works", async () => {
    readInBackground.mockResolvedValue({ cookies: [], unreadable: 0, appBound: 5 });
    vi.mocked(browserExecutable).mockReturnValue("C:\\chrome.exe");
    readCookiesThroughBrowser.mockResolvedValue([
      {
        domain: "example.com",
        hostOnly: true,
        name: "session",
        value: "x",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        expires: null,
      },
    ]);

    const result = await readCookies("chrome", "Default", ["example.com"]);
    expect(result.cookies).toHaveLength(1);
    expect(result.unreadable).toBe(0);
  });

  it("does not fail when some cookies were plainly readable despite the bridge failing", async () => {
    readInBackground.mockResolvedValue({
      cookies: [
        {
          domain: "plain.example",
          hostOnly: true,
          name: "a",
          value: "b",
          path: "/",
          secure: false,
          httpOnly: false,
          sameSite: "unspecified",
          expires: null,
        },
      ],
      unreadable: 0,
      appBound: 5,
    });
    vi.mocked(browserExecutable).mockReturnValue("C:\\chrome.exe");
    readCookiesThroughBrowser.mockRejectedValue(new Error("the browser exited"));

    const result = await readCookies("chrome", "Default", ["example.com", "plain.example"]);
    expect(result.cookies).toHaveLength(1);
    expect(result.unreadable).toBe(5);
  });
});
