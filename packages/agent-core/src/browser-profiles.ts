/**
 * Browser profiles of the side panel browser: separate sets of sign-ins. Stored in settings.json
 * (`SettingsFile.browserProfiles`); this module validates them and makes ids. The cookies and site
 * data live in the desktop app's Electron partition of each profile, which the app clears when a
 * profile disappears from this list.
 */
import {
  BROWSER_PROFILE_LIMITS,
  type BrowserProfile,
  type BrowserProfileImport,
  COOKIE_SOURCE_BROWSERS,
  DEFAULT_BROWSER_PROFILE_ID,
  type SaveBrowserProfileInput,
} from "@workspace/shared";
import { t } from "./i18n.ts";

const ID_PREFIX = "bp-";

export function defaultBrowserProfile(): BrowserProfile {
  return { id: DEFAULT_BROWSER_PROFILE_ID, name: "Default", createdAt: 0, lastImport: null };
}

/** Default profile first, then by name. */
export function sortBrowserProfiles(profiles: readonly BrowserProfile[]): BrowserProfile[] {
  return [...profiles].sort(
    (a, b) =>
      Number(b.id === DEFAULT_BROWSER_PROFILE_ID) - Number(a.id === DEFAULT_BROWSER_PROFILE_ID) ||
      a.name.localeCompare(b.name),
  );
}

function readImport(value: unknown): BrowserProfileImport | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Partial<Record<keyof BrowserProfileImport, unknown>>;
  const browser = COOKIE_SOURCE_BROWSERS.find((candidate) => candidate === entry.browser);
  if (
    !browser ||
    typeof entry.sourceProfile !== "string" ||
    typeof entry.at !== "number" ||
    typeof entry.count !== "number"
  )
    return null;
  return { browser, sourceProfile: entry.sourceProfile, at: entry.at, count: entry.count };
}

/**
 * Profiles read from settings.json. Entries that do not fit are dropped one by one, duplicate ids
 * keep the first, and the default profile is added when missing.
 */
export function readBrowserProfiles(raw: unknown): BrowserProfile[] {
  const profiles: BrowserProfile[] = [];
  const ids = new Set<string>();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const value = entry as Partial<Record<keyof BrowserProfile, unknown>>;
    const id = typeof value.id === "string" ? value.id : "";
    const name = typeof value.name === "string" ? value.name.trim() : "";
    if (!isProfileId(id) || ids.has(id) || !name) continue;
    ids.add(id);
    profiles.push({
      id,
      name: name.slice(0, BROWSER_PROFILE_LIMITS.maxNameLength),
      createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
      lastImport: readImport(value.lastImport),
    });
  }
  if (!ids.has(DEFAULT_BROWSER_PROFILE_ID)) profiles.unshift(defaultBrowserProfile());
  return profiles;
}

/**
 * Ids name the profile's partition folder on disk, so they stay lowercase letters, digits and
 * hyphens: the same on every file system.
 */
export function isProfileId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

/** The name of a profile being saved; throws a message for the person otherwise. */
export function validateProfileName(
  profiles: readonly BrowserProfile[],
  input: SaveBrowserProfileInput,
): string {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error(t("browserProfiles.nameRequired"));
  if (name.length > BROWSER_PROFILE_LIMITS.maxNameLength)
    throw new Error(t("limits.nameTooLong", { max: BROWSER_PROFILE_LIMITS.maxNameLength }));
  const key = name.toLocaleLowerCase();
  if (profiles.some((item) => item.id !== input.id && item.name.toLocaleLowerCase() === key))
    throw new Error(t("browserProfiles.nameTaken", { name }));
  return name;
}

/** `bp-<random>`: never reused, so a new profile never finds the cookies of a deleted one. */
export function newProfileId(profiles: readonly BrowserProfile[]): string {
  for (;;) {
    const id = `${ID_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
    if (!profiles.some((profile) => profile.id === id)) return id;
  }
}

export function validateImport(value: BrowserProfileImport): BrowserProfileImport {
  const entry = readImport(value);
  if (!entry) throw new Error(t("browserProfiles.importInvalid"));
  return entry;
}
