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
