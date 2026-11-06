/**
 * Reads what the person scanned or typed in the phone app: the pairing link from the computer's QR
 * code (`http://192.168.1.20:47830/#pair=CODE`), a bare address (`192.168.1.20:47830`, the port
 * defaulting to Phone access's own), or a name such as a Tailscale one. Null when it is no address.
 */
export function parseServerAddress(
  text: string,
  defaultPort: number,
): { server: string; code: string | null } | null {
  const value = text.trim();
  if (value === "") return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "") return null;
  // `URL` drops a default port, so `:80` typed on purpose would look like no port at all.
  const authority = value.replace(/^[a-z][a-z\d+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? "";
  const portGiven = /:\d+$/.test(authority);
  if (!portGiven && url.protocol === "http:") url.port = String(defaultPort);
  const code = /(?:^#|&)pair=([A-Za-z0-9-]+)/.exec(url.hash)?.[1] ?? null;
  return { server: url.origin, code };
}

/** Name suffixes that only resolve inside a home, office or tailnet. */
const PRIVATE_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal", ".ts.net"];

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part > 255)) {
    return false;
  }
  const [a = 0, b = 0] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    // Tailscale and other carrier-grade NAT addresses.
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * Whether the phone app may talk to `server` over plain HTTP: only when it is on the person's own
 * network (private, Tailscale, loopback and link-local addresses, single-label names, and names
 * under `.local`, `.lan`, `.home.arpa`, `.internal` or `.ts.net`). Anywhere else the device token
 * would cross the internet in the clear, so such a computer must be reached over HTTPS.
 */
export function allowsPlainHttp(server: string): boolean {
  const url = new URL(server);
  if (url.protocol !== "http:") return true;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    // Loopback, unique local (fc00::/7) and link-local (fe80::/10).
    return v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
  }
  if (/^\d+(\.\d+){3}$/.test(host)) return isPrivateIpv4(host);
  return (
    host === "localhost" ||
    !host.includes(".") ||
    PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}
