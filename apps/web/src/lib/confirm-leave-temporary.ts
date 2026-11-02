import { ConfirmModal } from "@/components/modals/confirm-modal";
import { i18n } from "@/lib/i18n";
import { useChatStore } from "@/stores/chat-store";

/**
 * Leaving a temporary chat deletes it for good. Resolves to true when nothing would be lost (the
 * open chat is not temporary, or has no messages) or when the person agrees to lose it.
 */
export async function confirmLeaveTemporary(): Promise<boolean> {
  const { temporary, messages, pending } = useChatStore.getState();
  if (!temporary || (messages.length === 0 && !pending)) return true;
  return ConfirmModal.show({
    title: i18n.t("chat:header.temporary.confirm.title"),
    description: i18n.t("chat:header.temporary.confirm.description"),
    confirmLabel: i18n.t("chat:header.temporary.confirm.action"),
  });
}
