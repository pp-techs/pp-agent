import {
  COOKIE_SOURCE_NAMES,
  type CookieSource,
  type CookieSourceBrowser,
} from "@workspace/shared";
import { translator } from "../../i18n.ts";
import {
  browserExecutable,
  CHROMIUM_BROWSERS,
  cookieFile,
  listChromiumProfiles,
  macKey,
  readChromiumCookies,
  readMacPassword,
  readWindowsKey,
  runningProcessCount,
  userDataDir,
} from "./chromium.ts";
import { readCookiesThroughBrowser } from "./chromium-cdp.ts";
import { LockedError } from "./database.ts";
import { listFirefoxProfiles, readFirefoxCookies } from "./firefox.ts";
import type { PortableCookie } from "./portable.ts";

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

/** Every cookie of one profile of an installed browser. Errors are worded for the person. */
export async function readCookies(
  browser: CookieSourceBrowser,
  sourceProfile: string,
): Promise<CookieRead> {
  const t = translator();
  const name = COOKIE_SOURCE_NAMES[browser];
  try {
    if (browser === "firefox") {
      const profile = (await listFirefoxProfiles()).find((entry) => entry.id === sourceProfile);
      if (!profile) throw new Error(t("panel.cookies.sourceNotFound", { browser: name }));
      return {
        cookies: await readFirefoxCookies(profile.dir),
        unreadable: 0,
        profileName: profile.name,
      };
    }
    return await readChromium(browser, sourceProfile);
  } catch (error) {
    if (error instanceof LockedError) throw await lockedMessage(browser, name, error);
    throw error;
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
): Promise<CookieRead> {
  const t = translator();
  const name = COOKIE_SOURCE_NAMES[browser];
  const definition = CHROMIUM_BROWSERS.find((entry) => entry.browser === browser);
  const userData = definition ? userDataDir(definition) : null;
  if (!definition || !userData || !chromiumSupported())
    throw new Error(t("panel.cookies.sourceNotFound", { browser: name }));
  const profile = (await listChromiumProfiles(definition)).find(
    (entry) => entry.id === sourceProfile,
  );
  const file = profile ? cookieFile(userData, profile.id) : null;
  if (!profile || !file) throw new Error(t("panel.cookies.sourceNotFound", { browser: name }));

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

  const read = await readChromiumCookies(file, key, platform);
  if (read.appBound === 0) return { ...read, profileName: profile.name };
  // Newer Windows browsers encrypt with a key only they can unwrap: ask the browser itself.
  const executable = browserExecutable(definition);
  if (executable) {
    try {
      const cookies = await readCookiesThroughBrowser(executable, userData, profile.id, file);
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
