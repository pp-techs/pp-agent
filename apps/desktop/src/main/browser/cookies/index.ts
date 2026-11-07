import {
  COOKIE_SOURCE_NAMES,
  type CookieSite,
  type CookieSource,
  type CookieSourceBrowser,
} from "@workspace/shared";
import { translator } from "../../i18n.ts";
import {
  browserExecutable,
  type ChromiumBrowser,
  CHROMIUM_BROWSERS,
  cookieFile,
  listChromiumProfiles,
  macKey,
  readMacPassword,
  readWindowsKey,
  quitBrowser,
  runningProcessCount,
  userDataDir,
} from "./chromium.ts";
import { readCookiesThroughBrowser } from "./chromium-cdp.ts";
import { LockedError } from "./database.ts";
import { listFirefoxProfiles } from "./firefox.ts";
import { cookieSite, groupSites, type PortableCookie } from "./portable.ts";
import { readInBackground } from "./reader-process.ts";

/** Chromium cookies can be decrypted on macOS and Windows; Firefox's are plain everywhere. */
function chromiumSupported(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

/** Installed browsers with at least one profile that has cookies, in the order of the list. */
export async function listCookieSources(): Promise<CookieSource[]> {
  const sources: CookieSource[] = [];
  if (chromiumSupported()) {
    for (const definition of CHROMIUM_BROWSERS) {
      const profiles = await listChromiumProfiles(definition).catch(() => []);
      if (profiles.length > 0) sources.push({ browser: definition.browser, profiles });
    }
  }
  const firefox = await listFirefoxProfiles().catch(() => []);
  if (firefox.length > 0)
    sources.push({
      browser: "firefox",
      profiles: firefox.map(({ id, name }) => ({ id, name })),
    });
  return sources;
}

export interface CookieRead {
  cookies: PortableCookie[];
  /** Cookies that could not be decrypted. */
  unreadable: number;
  /** Name of the source profile, for the import record. */
  profileName: string;
}

/**
 * Runs a read of a source profile; a database the browser keeps locked becomes a message for the
 * person.
 */
async function withLockedMessage<T>(browser: CookieSourceBrowser, read: () => Promise<T>) {
  try {
    return await read();
  } catch (error) {
    if (error instanceof LockedError)
      throw await lockedMessage(browser, COOKIE_SOURCE_NAMES[browser], error);
    throw error;
  }
}

/** The sites with cookies in one profile of an installed browser; no value is read. */
export async function listCookieSites(
  browser: CookieSourceBrowser,
  sourceProfile: string,
): Promise<CookieSite[]> {
  return withLockedMessage(browser, async () => {
    if (browser === "firefox") {
      const profile = await firefoxProfile(sourceProfile);
      return groupSites(await readInBackground({ kind: "firefox-hosts", profileDir: profile.dir }));
    }
    const { file } = await chromiumProfile(browser, sourceProfile);
    return groupSites(await readInBackground({ kind: "chromium-hosts", file }));
  });
}

/**
 * The cookies of the chosen sites (see `cookieSite`) of one profile of an installed browser.
 * Errors are worded for the person.
 */
export async function readCookies(
  browser: CookieSourceBrowser,
  sourceProfile: string,
  sites: readonly string[],
): Promise<CookieRead> {
  return withLockedMessage(browser, async () => {
    if (browser === "firefox") {
      const profile = await firefoxProfile(sourceProfile);
      return {
        cookies: await readInBackground({
          kind: "firefox",
          profileDir: profile.dir,
          sites: [...sites],
        }),
        unreadable: 0,
        profileName: profile.name,
      };
    }
    return readChromium(browser, sourceProfile, sites);
  });
}

async function firefoxProfile(sourceProfile: string) {
  const profile = (await listFirefoxProfiles()).find((entry) => entry.id === sourceProfile);
  if (!profile)
    throw new Error(
      translator()("panel.cookies.sourceNotFound", { browser: COOKIE_SOURCE_NAMES.firefox }),
    );
  return profile;
}

/** A Chromium profile looked up again by id (never a path from the renderer), with its database. */
async function chromiumProfile(
  browser: CookieSourceBrowser,
  sourceProfile: string,
): Promise<{
  definition: ChromiumBrowser;
  userData: string;
  profile: { id: string; name: string };
  file: string;
}> {
  const notFound = () =>
    new Error(
      translator()("panel.cookies.sourceNotFound", { browser: COOKIE_SOURCE_NAMES[browser] }),
    );
  const definition = CHROMIUM_BROWSERS.find((entry) => entry.browser === browser);
  const userData = definition ? userDataDir(definition) : null;
  if (!definition || !userData || !chromiumSupported()) throw notFound();
  const profile = (await listChromiumProfiles(definition)).find(
    (entry) => entry.id === sourceProfile,
  );
  const file = profile ? cookieFile(userData, profile.id) : null;
  if (!profile || !file) throw notFound();
  return { definition, userData, profile, file };
}

/** Whether a browser is running and so keeps its cookies locked; only told on Windows. */
export async function isCookieBrowserRunning(browser: CookieSourceBrowser): Promise<boolean> {
  const definition = CHROMIUM_BROWSERS.find((entry) => entry.browser === browser);
  if (!definition || process.platform !== "win32") return false;
  return ((await runningProcessCount(definition)) ?? 0) > 0;
}

/** Quits a browser (every window and background process), so its cookies can be copied. */
export async function quitCookieBrowser(browser: CookieSourceBrowser): Promise<void> {
  const definition = CHROMIUM_BROWSERS.find((entry) => entry.browser === browser);
  if (!definition || process.platform !== "win32") return;
  try {
    await quitBrowser(definition);
  } catch (error) {
    throw new Error(
      translator()("panel.cookies.quitFailed", {
        browser: COOKIE_SOURCE_NAMES[browser],
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Why the cookie database could not be copied. A lock held by background processes of a browser
 * whose windows are all closed is the usual case on Windows; when the browser is verifiably not
 * running, report the real error (security software, permissions) instead of telling the person
 * to quit it. If that cannot be told, give the quit advice together with the real error.
 */
async function lockedMessage(
  browser: CookieSourceBrowser,
  name: string,
  error: LockedError,
): Promise<Error> {
  const t = translator();
  const definition = CHROMIUM_BROWSERS.find((entry) => entry.browser === browser);
  const running =
    definition && process.platform === "win32" ? await runningProcessCount(definition) : 1;
  if (running === null)
    return new Error(`${t("panel.cookies.closeBrowser", { browser: name })} (${error.message})`);
  if (running > 0) return new Error(t("panel.cookies.closeBrowser", { browser: name }));
  return new Error(t("panel.cookies.copyBlocked", { browser: name, error: error.message }));
}

async function readChromium(
  browser: CookieSourceBrowser,
  sourceProfile: string,
  sites: readonly string[],
): Promise<CookieRead> {
  const t = translator();
  const name = COOKIE_SOURCE_NAMES[browser];
  const { definition, userData, profile, file } = await chromiumProfile(browser, sourceProfile);

  const platform = process.platform === "darwin" ? "darwin" : "win32";
  let key: Buffer;
  try {
    key =
      platform === "darwin"
        ? macKey(await readMacPassword(definition.keychain))
        : await readWindowsKey(userData);
  } catch (error) {
    throw new Error(
      platform === "darwin"
        ? t("panel.cookies.keyDenied", { browser: name })
        : t("panel.cookies.keyUnavailable", {
            browser: name,
            error: error instanceof Error ? error.message : String(error),
          }),
    );
  }

  const read = await readInBackground({
    kind: "chromium",
    file,
    key: key.toString("base64"),
    platform,
    sites: [...sites],
  });
  if (read.appBound === 0) return { ...read, profileName: profile.name };
  // Newer Windows browsers encrypt with a key only they can unwrap: ask the browser itself, and
  // keep the chosen sites of what it hands over.
  const executable = browserExecutable(definition);
  if (executable) {
    try {
      const chosen = new Set(sites);
      const cookies = (
        await readCookiesThroughBrowser(executable, userData, profile.id, file)
      ).filter((cookie) => chosen.has(cookieSite(cookie.domain)));
      return { cookies, unreadable: 0, profileName: profile.name };
    } catch (error) {
      console.error(`Could not read ${name} cookies through the browser:`, error);
    }
  }
  return {
    cookies: read.cookies,
    unreadable: read.unreadable + read.appBound,
    profileName: profile.name,
  };
}
