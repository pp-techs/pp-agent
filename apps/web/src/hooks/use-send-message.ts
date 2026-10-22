import type { DesktopBridge } from "@workspace/shared";
import { toast } from "sonner";

import { useAgentCommands } from "@/lib/queries";
import { useComposerStore } from "@/stores/composer-store";

/**
 * Sends `text` with the composer's attachments and clears the composer. When sending fails, the
 * text and attachments go back into the composer so nothing is lost.
 */
export function useSendMessage(bridge: DesktopBridge) {
  const { prompt } = useAgentCommands(bridge);
  return (text: string) => {
    const { attachments, setDraft, clear, restore } = useComposerStore.getState();
    setDraft("");
    clear();
    prompt.mutate(
      { text, attachments: attachments.map(({ id: _id, ...attachment }) => attachment) },
      {
        onError: (error) => {
          setDraft(text);
          restore(attachments);
          toast.error(error.message);
        },
      },
    );
  };
}
