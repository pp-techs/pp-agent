import {
  chatKeyPrefix,
  type ScheduleDelivery,
  type TelegramStatus,
  type ZaloStatus,
} from "@workspace/shared";

export interface DeliveryChoice {
  /** `session`, `none`, or `peer:<chat key>`. */
  value: string;
  label: string;
}

/** A chat app account as the choices need it, whichever app it is. */
interface DeliveryAccount {
  kind: "telegram" | "zalo";
  id: string;
  label: string;
  enabled: boolean;
  ownerId: number | string | null;
  ownerName: string | null;
  chats: Record<string, { label?: string }>;
}

const accountsOf = (
  kind: DeliveryAccount["kind"],
  list: readonly (TelegramStatus | ZaloStatus)[] | undefined,
): DeliveryAccount[] =>
  (list ?? []).map((status) => ({
    kind,
    id: status.id,
    label: status.label,
    enabled: status.enabled && status.hasToken,
    ownerId: status.ownerId,
    ownerName: status.ownerName,
    chats: status.chats ?? {},
  }));

/** The value a select uses for a delivery; no delivery set means the default, `session`. */
export function deliveryValue(delivery: ScheduleDelivery | undefined): string {
  if (!delivery || delivery.to === "session") return "session";
  return delivery.to === "none" ? "none" : `peer:${delivery.peer}`;
}

/** The delivery a select value stands for. */
export function deliveryOf(value: string): ScheduleDelivery {
  if (value === "none") return { to: "none" };
  if (value.startsWith("peer:")) return { to: "peer", peer: value.slice(5) };
  return { to: "session" };
}

/**
 * The chats a result can be sent to: the paired person's own chat on each chat app account that
 * is on, then each chat added to that account. `appName` names an app ("Telegram").
 */
export function chatChoices(
  telegram: readonly TelegramStatus[] | undefined,
  zalo: readonly ZaloStatus[] | undefined,
  appName: (kind: DeliveryAccount["kind"]) => string,
): DeliveryChoice[] {
  const choices: DeliveryChoice[] = [];
  for (const account of [...accountsOf("telegram", telegram), ...accountsOf("zalo", zalo)]) {
    // Sending needs a paired owner and a running account.
    if (!account.enabled || account.ownerId === null) continue;
    const app = account.label
      ? `${appName(account.kind)} (${account.label})`
      : appName(account.kind);
    const prefix = chatKeyPrefix(account.kind, account.id);
    const ownerId = String(account.ownerId);
    choices.push({
      value: `peer:${prefix}:${ownerId}`,
      label: `${app} – ${account.ownerName ?? ownerId}`,
    });
    for (const [chatId, chat] of Object.entries(account.chats)) {
      if (chatId === ownerId) continue;
      choices.push({
        value: `peer:${prefix}:${chatId}`,
        label: `${app} – ${chat.label || chatId}`,
      });
    }
  }
  return choices;
}
