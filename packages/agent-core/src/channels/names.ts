/** Vault id prefix of chat channel secrets; Pi's provider list skips it like search keys. */
export const CHANNEL_KEY_PREFIX = "channel:";

/**
 * Vault id of the first Telegram bot's token, stored as `{ type: "api_key", key: <token> }`.
 * Other accounts use `channel:telegram:<account>` (see `accountTokenKey`).
 */
export const TELEGRAM_TOKEN_KEY = `${CHANNEL_KEY_PREFIX}telegram`;

/** Vault id of the first Zalo bot's token; other accounts use `channel:zalo:<account>`. */
export const ZALO_TOKEN_KEY = `${CHANNEL_KEY_PREFIX}zalo`;
