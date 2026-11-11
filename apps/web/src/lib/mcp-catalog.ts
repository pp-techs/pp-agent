import type { McpOAuthClient, McpServerSettings } from "@workspace/shared";

import atlassian from "../assets/connectors/atlassian.svg";
import gmail from "../assets/connectors/gmail.svg";
import googleCalendar from "../assets/connectors/google-calendar.svg";
import googleDocs from "../assets/connectors/google-docs.svg";
import googleDrive from "../assets/connectors/google-drive.svg";
import googleSheets from "../assets/connectors/google-sheets.svg";
import linear from "../assets/connectors/linear.svg";
import notion from "../assets/connectors/notion.svg";
import ppHub from "../assets/connectors/pp-hub.svg";
import sentry from "../assets/connectors/sentry.svg";
import stripe from "../assets/connectors/stripe.svg";
import supabase from "../assets/connectors/supabase.svg";
import upstash from "../assets/connectors/upstash.svg";

/**
 * What a person does to connect, after pressing Connect. `oauth`, `address` and `folder` can be
 * repeated (a second account, a second hub, a second folder); `open` is one server.
 */
export type McpPresetSetup =
  /** The server asks for a sign-in in the browser. */
  | "oauth"
  /** Nothing: the server is open. */
  | "open"
  /** An address the person types (their company's hub); the preset's path is appended to it. */
  | "address"
  /** A folder on this computer, picked in the system dialog and appended to the command. */
  | "folder";

export type McpPresetConnection =
  | { transport: "http"; url: string }
  /** An address preset: `<the address the person typed>` + this path. */
  | { transport: "http"; path: string }
  | { transport: "stdio"; command: string; args: string[] };

export type McpPresetId =
  | "gmail"
  | "calendar"
  | "drive"
  | "docs"
  | "sheets"
  | "notion"
  | "atlassian"
  | "linear"
  | "stripe"
  | "supabase"
  | "sentry"
  | "context7"
  | "pp-hub"
  | "filesystem";

/**
 * A server Settings can add in one step. `id` is the default server name (letters, digits, `_`, `-`);
 * the card text lives in the `extensions` locale under `connectors.items.<id>`.
 */
export interface McpPreset {
  id: McpPresetId;
  name: string;
  /** Brand logo bundled with the app (the renderer's CSP blocks remote images); null shows a generic icon. */
  logo: string | null;
  setup: McpPresetSetup;
  connection: McpPresetConnection;
  /**
   * Google registers no OAuth clients on the fly, so these servers sign in with the app's own
   * Google client (`google-oauth.ts`), asking for these scopes.
   */
  googleScopes?: readonly string[];
  /**
   * How this server's sign-in names the app when its authorization server has no registration
   * endpoint: `cimd` presents the app's Client ID Metadata Document instead of registering.
   */
  clientRegistration?: McpOAuthClient["clientRegistration"];
  /**
   * Scopes the sign-in asks for. An authorization server that always asks for consent (Logto, and
   * so every hub) denies a request that names no scope at all, so `cimd` presets say `openid
   * offline_access` even though the hub's tokens carry no scopes.
   */
  scope?: string;
}

const GOOGLE = "https://www.googleapis.com/auth/";
const google = (...names: string[]) => names.map((name) => `${GOOGLE}${name}`);

/** Logos are from https://thesvg.org (see `assets/connectors/README.md`). */
export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: "gmail",
    name: "Gmail",
    logo: gmail,
    setup: "oauth",
    connection: { transport: "http", url: "https://gmailmcp.googleapis.com/mcp/v1" },
    googleScopes: google("gmail.readonly", "gmail.compose"),
  },
  {
    id: "calendar",
    name: "Google Calendar",
    logo: googleCalendar,
    setup: "oauth",
    connection: { transport: "http", url: "https://calendarmcp.googleapis.com/mcp/v1" },
    googleScopes: google(
      "calendar.calendarlist.readonly",
      "calendar.events.freebusy",
      "calendar.events.readonly",
    ),
  },
  {
    id: "drive",
    name: "Google Drive",
    logo: googleDrive,
    setup: "oauth",
    connection: { transport: "http", url: "https://drivemcp.googleapis.com/mcp/v1" },
    googleScopes: google("drive.readonly", "drive.file"),
  },
  {
    id: "docs",
    name: "Google Docs",
    logo: googleDocs,
    setup: "oauth",
    connection: { transport: "http", url: "https://docsmcp.googleapis.com/mcp/v1" },
    googleScopes: google("drive.readonly", "drive.file", "documents.readonly", "documents"),
  },
  {
    id: "sheets",
    name: "Google Sheets",
    logo: googleSheets,
    setup: "oauth",
    connection: { transport: "http", url: "https://sheetsmcp.googleapis.com/mcp/v1" },
    googleScopes: google("drive.readonly", "drive.file", "spreadsheets.readonly", "spreadsheets"),
  },
  {
    id: "notion",
    name: "Notion",
    logo: notion,
    setup: "oauth",
    connection: { transport: "http", url: "https://mcp.notion.com/mcp" },
  },
  {
    id: "atlassian",
    name: "Atlassian",
    logo: atlassian,
    setup: "oauth",
    connection: { transport: "http", url: "https://mcp.atlassian.com/v2/mcp" },
  },
  {
    id: "linear",
    name: "Linear",
    logo: linear,
    setup: "oauth",
    connection: { transport: "http", url: "https://mcp.linear.app/mcp" },
  },
  {
    id: "stripe",
    name: "Stripe",
    logo: stripe,
    setup: "oauth",
    connection: { transport: "http", url: "https://mcp.stripe.com" },
  },
  {
    id: "supabase",
    name: "Supabase",
    logo: supabase,
    setup: "oauth",
    connection: { transport: "http", url: "https://mcp.supabase.com/mcp" },
  },
  {
    id: "sentry",
    name: "Sentry",
    logo: sentry,
    setup: "oauth",
    connection: { transport: "http", url: "https://mcp.sentry.dev/mcp" },
  },
  {
    id: "context7",
    name: "Context7",
    // Context7 is an Upstash product and has no logo of its own in the library.
    logo: upstash,
    setup: "open",
    connection: { transport: "http", url: "https://mcp.context7.com/mcp" },
  },
  {
    id: "pp-hub",
    name: "PP Hub",
    logo: ppHub,
    setup: "address",
    connection: { transport: "http", path: "/mcp/" },
    // Each company runs its own hub, and every hub signs in through Logto, which registers no
    // clients: the app names itself with its Client ID Metadata Document instead. Logto always
    // asks for consent, and denies a request that names no scope, so these are asked for — the
    // hub's own tokens still carry none.
    clientRegistration: "cimd",
    scope: "openid offline_access",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    logo: null,
    setup: "folder",
    connection: {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
    },
  },
];

/** The presets that can be offered: Google's need the app's Google client. */
export function availablePresets(googleClient: McpOAuthClient | null) {
  return MCP_PRESETS.filter((preset) => googleClient !== null || preset.googleScopes === undefined);
}

/** True when a configured server runs what the preset would add, whatever its name or account. */
export function matchesPreset(preset: McpPreset, server: McpServerSettings) {
  // Written when Connectors added the server: the only way to tell an address preset's servers
  // apart, since each company chooses the address.
  if (server.connector !== undefined) return server.connector === preset.id;
  const { connection } = preset;
  if (connection.transport === "http") {
    if (!("url" in connection)) return false;
    // `https://x.test/mcp/` and `https://x.test/mcp` are the same address.
    const trim = (url: string) => url.replace(/\/+$/, "");
    return server.transport === "http" && trim(server.url ?? "") === trim(connection.url);
  }
  return (
    server.transport === "stdio" &&
    server.command === connection.command &&
    connection.args.every((arg) => server.args?.includes(arg))
  );
}

/**
 * The MCP address of an `address` preset: `hub.acme.vn`, `https://hub.acme.vn/` and
 * `https://hub.acme.vn/mcp/` all become `https://hub.acme.vn/mcp/`. Null when the text is not an
 * https address (or plain http on this computer).
 */
export function addressPresetUrl(preset: McpPreset, address: string): string | null {
  const { connection } = preset;
  if (connection.transport !== "http" || !("path" in connection)) return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(candidate)) return null;
  const url = new URL(candidate);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  // Any path the person pasted (the `/mcp/` address itself) is replaced by the preset's own.
  return `${url.origin}${connection.path}`;
}

/** What an address preset's row is called: the hub it points at. */
export function connectorHost(url: string | undefined): string | undefined {
  if (!url || !URL.canParse(url)) return undefined;
  return new URL(url).host;
}

/** “Công việc” → `cong-viec`; empty when nothing usable is left. */
function slug(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The server name for a preset: its id, plus the account's label when there is one (`gmail-work`,
 * which is also how the agent tells the accounts apart), and `-2`, `-3`… when that name is taken.
 */
export function serverName(
  preset: McpPreset,
  account: string | undefined,
  taken: readonly string[],
) {
  const suffix = account ? slug(account) : "";
  const base = suffix ? `${preset.id}-${suffix}` : preset.id;
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

interface PresetServerInput {
  name: string;
  description: string;
  /** Which account of the service this is, when it has more than one. */
  account?: string;
  /** What a `folder` preset asks for. */
  folder?: string;
  /** What an `address` preset asks for: the address as the person typed it. */
  address?: string;
  /** The app's Google client; required for presets with `googleScopes`. */
  googleClient?: McpOAuthClient | null;
}

/** The server entry to save. */
export function presetServer(preset: McpPreset, input: PresetServerInput): McpServerSettings {
  const { name, description, account, folder = "", address = "", googleClient } = input;
  const base = {
    name,
    description,
    enabled: true,
    exposure: "codemode",
    // Kept on every later save, and what tells an address preset's servers apart.
    connector: preset.id,
    ...(account ? { account } : {}),
  } as const;
  const { connection } = preset;
  if (connection.transport === "http") {
    if (preset.googleScopes && !googleClient)
      throw new Error(`${preset.name} needs a Google client`);
    const url = "path" in connection ? addressPresetUrl(preset, address) : connection.url;
    if (!url) throw new Error(`${preset.name} needs an address`);
    const oauth = preset.googleScopes
      ? { ...googleClient!, scope: preset.googleScopes.join(" ") }
      : preset.clientRegistration
        ? {
            clientRegistration: preset.clientRegistration,
            ...(preset.scope ? { scope: preset.scope } : {}),
          }
        : undefined;
    return { ...base, transport: "http", url, ...(oauth ? { oauth } : {}) };
  }
  return {
    ...base,
    transport: "stdio",
    command: connection.command,
    args: preset.setup === "folder" ? [...connection.args, folder] : connection.args,
  };
}
