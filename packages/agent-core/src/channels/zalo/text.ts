import type { resources } from "@workspace/shared/i18n";

/** Every sentence the Zalo bot sends lives under `backend:channels.zalo`; names are typed from English. */
export type ZaloTextName = keyof (typeof resources)["en"]["backend"]["channels"]["zalo"];
export type ZaloTextKey = `channels.zalo.${ZaloTextName}`;

/** The agent-side translator (`t` from `i18n.ts`), narrowed to the texts of this channel. */
export type ZaloTranslate = (key: ZaloTextKey, vars?: Record<string, string | number>) => string;
