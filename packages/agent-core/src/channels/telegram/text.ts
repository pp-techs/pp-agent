import type { resources } from "@workspace/shared/i18n";

/** Every sentence the bot sends lives under `backend:channels.telegram`; names are typed from English. */
export type TelegramTextName = keyof (typeof resources)["en"]["backend"]["channels"]["telegram"];
export type TelegramTextKey = `channels.telegram.${TelegramTextName}`;

/** The agent-side translator (`t` from `i18n.ts`), narrowed to the texts of this channel. */
export type TelegramTranslate = (
  key: TelegramTextKey,
  vars?: Record<string, string | number>,
) => string;
