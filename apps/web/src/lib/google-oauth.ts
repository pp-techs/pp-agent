import type { McpOAuthClient } from "@workspace/shared";

const clientId: unknown = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
const clientSecret: unknown = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_SECRET;

/**
 * The address Google sends the browser back to after sign-in. A Google “Web application” client
 * accepts only redirect URIs registered one by one, so the port is fixed; register exactly this
 * address as an authorized redirect URI of the client.
 */
export const GOOGLE_CALLBACK_URL = "http://127.0.0.1:8976/callback";

/**
 * The OAuth client PP Agent signs in to Google's MCP servers with (a “Web application” client of a
 * Google Cloud project, created with “Use this client for an AI-powered agent”). It is set when
 * the app is built, from `VITE_GOOGLE_OAUTH_CLIENT_ID` and `VITE_GOOGLE_OAUTH_CLIENT_SECRET`;
 * without an id the Google connectors are not offered. The secret ships inside the app, so it
 * is not confidential: Google's consent screen and the redirect list are the protection.
 */
export const GOOGLE_CLIENT: McpOAuthClient | null =
  typeof clientId === "string" && clientId !== ""
    ? {
        clientId,
        ...(typeof clientSecret === "string" && clientSecret !== "" ? { clientSecret } : {}),
        callbackUrl: GOOGLE_CALLBACK_URL,
      }
    : null;
