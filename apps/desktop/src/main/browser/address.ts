/** Schemes a side panel page may load or navigate to; everything else is refused. */
export function isWebUrl(url: string): boolean {
  if (url === "about:blank") return true;
  if (!URL.canParse(url)) return false;
  const { protocol } = new URL(url);
  return protocol === "https:" || protocol === "http:";
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i;
/** `example.com`, `sub.example.co/path`, `10.0.0.1:8080`: a dot, no spaces. */
const HOST_LIKE = /^[^\s/?#]+\.[^\s/?#]+(:\d+)?([/?#]\S*)?$/;

/**
 * What the address bar typed means: a web address as is, a host without scheme (https, or http
 * for this computer), or else a web search.
 */
export function toAddress(input: string): string {
  const text = input.trim();
  if (!text) return "about:blank";
  if (/^https?:\/\//i.test(text) && URL.canParse(text)) return text;
  if (LOCAL_HOST.test(text)) return `http://${text}`;
  if (HOST_LIKE.test(text) && URL.canParse(`https://${text}`)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

/**
 * A Chrome user agent without the `Electron/…` and app tokens: some sites (Google sign-in among
 * them) refuse browsers they do not recognize. Chrome itself reports only its major version.
 */
export function chromeUserAgent(platform: NodeJS.Platform, chromeVersion: string): string {
  const os =
    platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  const major = chromeVersion.split(".")[0];
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
