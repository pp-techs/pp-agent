import type { Attachment, ChatMessage, ChatPart, DesktopBridge } from "@workspace/shared";
import { toast } from "sonner";

import { useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";
import { useComposerStore } from "@/stores/composer-store";

/**
 * What the person sent, as they typed and attached it. Shown at once so the message does not look
 * lost while the conversation saves it; the conversation's own copy replaces it.
 */
function pendingMessage(text: string, attachments: Attachment[]): ChatMessage {
  const parts: ChatPart[] = [];
  if (text) parts.push({ type: "text", text });
  for (const attachment of attachments) {
    if (attachment.data)
      parts.push({ type: "image", mimeType: attachment.mimeType, data: attachment.data });
    else if (attachment.path)
      parts.push({ type: "file", name: attachment.name, path: attachment.path });
  }
  return { id: crypto.randomUUID(), role: "user", parts };
}

/**
 * Sends `text` with the composer's attachments and clears the composer. The message shows in the
 * thread right away. When sending fails, the text and attachments go back into the composer so
 * nothing is lost.
 */
export function useSendMessage(bridge: DesktopBridge) {
  const { prompt } = useAgentCommands(bridge);
  return (text: string) => {
    const { attachments, setDraft, clear, restore } = useComposerStore.getState();
    const { setPending } = useChatStore.getState();
    setPending(pendingMessage(text, attachments));
    setDraft("");
    clear();
    prompt.mutate(
      { text, attachments: attachments.map(({ id: _id, ...attachment }) => attachment) },
      {
        onError: (error) => {
          setPending(null);
          setDraft(text);
          restore(attachments);
          toast.error(error.message);
        },
      },
    );
  };
}
