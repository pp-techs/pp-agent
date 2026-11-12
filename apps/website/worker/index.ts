/**
 * Serves PP Agent's OAuth Client ID Metadata Documents under /oauth/. Everything else is a static
 * asset (`run_worker_first` in wrangler.jsonc lists only /oauth/*).
 *
 * The desktop app signs in to MCP servers whose authorization server registers no clients (Logto,
 * so PP Hub) by sending this document's URL as its `client_id`; the server fetches it and shows the
 * name and logo on its consent screen. Pi's MCP extension asks for `<base>/client.json`, or
 * `<base>/<id>/client.json` with the redirect URI `/callback/<id>` when the authorization server
 * does not send `iss`. The app points it here with PI_MCP_CLIENT_METADATA_BASE_URL.
 */
const SITE = "https://ppagent.monback.app";
const BASE = `${SITE}/oauth`;
/** What Pi's `callbackId` makes: 9 bytes as base64url. */
const CALLBACK_ID = /^[A-Za-z0-9_-]{12}$/;

function metadataDocument(id: string | undefined) {
  const suffix = id ? `/${id}` : "";
  return {
    client_id: `${BASE}${suffix}/client.json`,
    client_name: "PP Agent",
    client_uri: SITE,
    logo_uri: `${SITE}/icon-512.png`,
    application_type: "native",
    // Loopback redirects are matched on any port (RFC 8252 section 7.3).
    redirect_uris: [`http://127.0.0.1/callback${suffix}`, `http://localhost/callback${suffix}`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export default {
  fetch(request: Request): Response {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const match = /^\/oauth\/(?:([^/]+)\/)?client\.json$/.exec(new URL(request.url).pathname);
    const id = match?.[1];
    if (!match || (id !== undefined && !CALLBACK_ID.test(id))) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(request.method === "HEAD" ? null : JSON.stringify(metadataDocument(id)), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
