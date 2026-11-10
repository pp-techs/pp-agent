import { ARTIFACT_FRAME_URL, ARTIFACT_LIBS } from "@workspace/shared";

/** The frame page shipped beside the app, for a browser and the phone app (see public/). */
const FRAME_PAGE = "artifact-frame.html";
/** Folder of the libraries the frame may load, next to the frame page. */
const LIB_FOLDER = "artifact-libs/";

/**
 * Where the sandboxed preview frame comes from: the desktop app serves it from its `pp-artifact`
 * scheme; everywhere else it is a page of the app's own origin, so the frame inherits nothing of
 * the app page's policy and carries its own (the page holds no network at all).
 */
export function artifactFrameUrl(kind: "desktop" | "web", base: string): string {
  return kind === "desktop" ? ARTIFACT_FRAME_URL : new URL(FRAME_PAGE, base).href;
}

/**
 * The preview libraries an HTML page names through the desktop scheme (`pp-artifact://lib/…`),
 * pointed at the copies bundled beside the app. The desktop app leaves the page as it is: its
 * scheme answers those addresses.
 */
export function withLocalLibraries(html: string, kind: "desktop" | "web", base: string): string {
  if (kind === "desktop") return html;
  let out = html;
  for (const url of Object.values(ARTIFACT_LIBS)) {
    const name = url.slice(url.lastIndexOf("/") + 1);
    out = out.split(url).join(new URL(`${LIB_FOLDER}${name}`, base).href);
  }
  return out;
}
