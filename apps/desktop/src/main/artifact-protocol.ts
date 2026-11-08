import { readFile } from "node:fs/promises";
import { ARTIFACT_FRAME_URL, ARTIFACT_LIBS, ARTIFACT_SCHEME } from "@workspace/shared";
import { protocol, type Session } from "electron";

/**
 * Policy of the HTML preview frame. Its scripts run (the person pressed Run), but nothing may reach
 * the network or leave the frame: no fetch, no remote images, fonts or scripts, no forms, no nested
 * frames. Libraries load only from this scheme. The frame is also `sandbox="allow-scripts"` in the
 * renderer, so its origin is opaque and it never sees the app's storage or bridge.
 */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${ARTIFACT_SCHEME}:`,
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * The frame's own page. The renderer posts `{ type: "render", html }` once; the page writes it into
 * its own document (the policy above stays with the document) followed by a script that reports the
 * content height, which the renderer uses to size the frame. The height is the root element's box,
 * rounded up: `scrollHeight` never shrinks below the frame and rounds a fractional overflow down,
 * which shows a scroll bar that narrows the page and makes responsive charts resize in a loop.
 */
const FRAME_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"></head><body><script>
addEventListener("message", function onRender(event) {
  if (event.source !== parent || !event.data || event.data.type !== "render") return;
  removeEventListener("message", onRender);
  var report = "<script>(function(){var last=0;function send(){var h=Math.ceil(document.documentElement.getBoundingClientRect().height);if(h!==last){last=h;parent.postMessage({type:'height',height:h},'*');}}new ResizeObserver(send).observe(document.documentElement);addEventListener('load',send);send();})();<\\/script>";
  document.open();
  document.write(String(event.data.html) + report);
  document.close();
});
parent.postMessage({ type: "ready" }, "*");
</script></body></html>`;

/** File names in the libraries folder, as in `pp-artifact://lib/<name>`. */
const LIB_NAMES = new Set(
  Object.values(ARTIFACT_LIBS).map((url) => url.slice(`${ARTIFACT_SCHEME}://lib/`.length)),
);

/** Must run before the app is ready: a standard, secure scheme with no CORS or CSP bypass. */
export function registerArtifactScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ARTIFACT_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

/**
 * What the scheme answers for `url`: the frame page, an allowlisted library from `libPath`, or 404.
 * No other path is ever read, so a crafted address cannot reach other files.
 */
export async function artifactResponse(
  url: string,
  libPath: (name: string) => string,
): Promise<Response> {
  const parsed = new URL(url);
  const headers = { "Content-Security-Policy": ARTIFACT_CSP, "X-Content-Type-Options": "nosniff" };
  if (parsed.href === ARTIFACT_FRAME_URL) {
    return new Response(FRAME_PAGE, {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const name = parsed.pathname.slice(1);
  if (parsed.host === "lib" && LIB_NAMES.has(name) && !parsed.search && !parsed.hash) {
    try {
      const body = await readFile(libPath(name));
      return new Response(body, {
        headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" },
      });
    } catch {
      // A missing library answers 404 like any other address.
    }
  }
  return new Response("Not found", { status: 404, headers });
}

/** Serves the scheme in the app window's session; side panel partitions never get it. */
export function handleArtifactScheme(session: Session, libPath: (name: string) => string): void {
  session.protocol.handle(ARTIFACT_SCHEME, (request) => artifactResponse(request.url, libPath));
}
