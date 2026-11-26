/**
 * Two-pass secret redaction for text leaving a conversation into persistent or external sinks
 * (memory extraction, subagent summaries before truncation, session recall).
 *
 * Pass 1 masks structured secret patterns (PEM private keys, known API key prefixes, Bearer
 * tokens, URL credentials, JSON secret fields) and records every raw token (>= 16 chars) that was
 * masked. Pass 2 masks any bare repetition of those learned tokens elsewhere in the same text, so
 * a credential caught in a header or URL is also scrubbed where the model repeats it in prose.
 */

const REDACTED = "[REDACTED]";
const TOKEN_RE = /[A-Za-z0-9_\-./+]{16,}/g;

/** Invisible formatting / bidi override characters that can hide prompt injection. */
const INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

const PEM_BLOCK_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

const KNOWN_KEY_RE =
  /\b(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,})\b/g;

const BEARER_RE = /\b(Bearer\s+)([A-Za-z0-9_\-.~+/=]{16,})/gi;

const URL_USERINFO_RE = /(https?:\/\/[^/\s:@?#]+:)([^/\s@?#]+)(@)/gi;

const URL_SECRET_PARAM_RE =
  /([?&](?:api[_-]?key|apikey|token|access[_-]?token|auth|secret|password|passwd|key|x-amz-signature|sig|signature)=)([^&#\s]{8,})/gi;

const JSON_SECRET_FIELD_RE =
  /("(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret(?:[_-]?key)?|client[_-]?secret|password|passwd|private[_-]?key|master[_-]?key|bot[_-]?token)"\s*:\s*")([^"\r\n]{8,})(")/gi;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strips invisible zero-width and bidi override characters from untrusted text. */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_RE, "");
}

/**
 * Scrubs secret patterns from `text` in two passes: structured patterns first, then any bare
 * repetition of tokens caught in pass 1.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  const learned = new Set<string>();
  const record = (raw: string) => {
    if (raw.length >= 16) learned.add(raw);
    for (const token of raw.match(TOKEN_RE) ?? []) learned.add(token);
  };

  let out = text.replace(PEM_BLOCK_RE, (match) => {
    record(match);
    return REDACTED;
  });
  out = out.replace(KNOWN_KEY_RE, (match) => {
    record(match);
    return REDACTED;
  });
  out = out.replace(BEARER_RE, (_match, prefix: string, token: string) => {
    record(token);
    return `${prefix}${REDACTED}`;
  });
  out = out.replace(URL_USERINFO_RE, (_match, prefix: string, secret: string, at: string) => {
    record(secret);
    return `${prefix}${REDACTED}${at}`;
  });
  out = out.replace(URL_SECRET_PARAM_RE, (_match, prefix: string, secret: string) => {
    record(secret);
    return `${prefix}${REDACTED}`;
  });
  out = out.replace(
    JSON_SECRET_FIELD_RE,
    (_match, prefix: string, secret: string, suffix: string) => {
      record(secret);
      return `${prefix}${REDACTED}${suffix}`;
    },
  );

  if (learned.size === 0) return out;
  const repeated = [...learned]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|");
  return out.replace(new RegExp(repeated, "g"), REDACTED);
}
