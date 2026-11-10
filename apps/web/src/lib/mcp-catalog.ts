import type { McpOAuthClient, McpServerSettings } from "@workspace/shared";

import atlassian from "../assets/connectors/atlassian.svg";
import gmail from "../assets/connectors/gmail.svg";
import googleCalendar from "../assets/connectors/google-calendar.svg";
import googleDocs from "../assets/connectors/google-docs.svg";
import googleDrive from "../assets/connectors/google-drive.svg";
import googleSheets from "../assets/connectors/google-sheets.svg";
import linear from "../assets/connectors/linear.svg";
import notion from "../assets/connectors/notion.svg";
import sentry from "../assets/connectors/sentry.svg";
import stripe from "../assets/connectors/stripe.svg";
import supabase from "../assets/connectors/supabase.svg";
import upstash from "../assets/connectors/upstash.svg";

/**
 * What a person does to connect, after pressing Connect. `oauth` and `folder` can be repeated (a
 * second account, a second folder); `open` is one server.
 */
export type McpPresetSetup =
  /** The server asks for a sign-in in the browser. */
  | "oauth"
  /** Nothing: the server is open. */
  | "open"
  /** A folder on this computer, picked in the system dialog and appended to the command. */
  | "folder";

export type McpPresetConnection =
  | { transport: "http"; url: string }
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
  const { connection } = preset;
  if (connection.transport === "http") {
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
  /** The app's Google client; required for presets with `googleScopes`. */
  googleClient?: McpOAuthClient | null;
}

/** The server entry to save. */
export function presetServer(preset: McpPreset, input: PresetServerInput): McpServerSettings {
  const { name, description, account, folder = "", googleClient } = input;
  const base = {
    name,
    description,
    enabled: true,
    exposure: "codemode",
    ...(account ? { account } : {}),
  } as const;
  const { connection } = preset;
  if (connection.transport === "http") {
    if (preset.googleScopes && !googleClient)
      throw new Error(`${preset.name} needs a Google client`);
    return {
      ...base,
      transport: "http",
      url: connection.url,
      ...(preset.googleScopes && googleClient
        ? { oauth: { ...googleClient, scope: preset.googleScopes.join(" ") } }
        : {}),
    };
  }
  return {
    ...base,
    transport: "stdio",
    command: connection.command,
    args: preset.setup === "folder" ? [...connection.args, folder] : connection.args,
  };
}
