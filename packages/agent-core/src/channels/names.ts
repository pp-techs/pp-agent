/** Vault id prefix of chat channel secrets; Pi's provider list skips it like search keys. */
export const CHANNEL_KEY_PREFIX = "channel:";

/** Vault id of the Telegram bot token, stored as `{ type: "api_key", key: <token> }`. */
export const TELEGRAM_TOKEN_KEY = `${CHANNEL_KEY_PREFIX}telegram`;
