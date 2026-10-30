import { t } from "./i18n.ts";

/**
 * A short, readable reason for a failed model turn. Providers and gateways put raw JSON, request
 * ids and headers in the error text; the person only needs to know what to do next, so the raw
 * text goes to the log and the chat shows one sentence.
 */
export function modelErrorText(raw: string | undefined): string {
  const message = raw?.trim();
  if (!message) return t("conversations.modelError");
  console.error("[model]", message);

  // Pi prefixes provider errors with the HTTP status, e.g. `524 {"type":...}`.
  const status = Number(/^\s*(\d{3})\b/.exec(message)?.[1]);
  if (status === 429 || /rate.?limit|too many requests/i.test(message))
    return t("conversations.modelRateLimited");
  if (status === 401 || status === 403) return t("conversations.modelRejected");
  if (status === 408 || status === 504 || status === 524 || /time-?d? ?out/i.test(message))
    return t("conversations.modelTimeout");
  if (status >= 500) return t("conversations.modelUnavailable");
  return t("conversations.modelError");
}
