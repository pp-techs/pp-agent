import { DEFAULT_AGENT_ID, type DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleDashedIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useSendMessage } from "@/hooks/use-send-message";
import { agentsQuery } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";

/** Start of a conversation: who the agent is, and its starter prompts. */
export function EmptyChat({ bridge }: { bridge: DesktopBridge }) {
  const summary = useChatStore((state) => state.agent);
  const workspaceDir = useChatStore((state) => state.workspaceDir);
  const agents = useQuery(agentsQuery(bridge));
  const send = useSendMessage(bridge);
  const agent = agents.data?.find((item) => item.id === (summary?.id ?? DEFAULT_AGENT_ID));
  // The built-in agent introduces itself with the general copy until someone describes it.
  const generic = !summary || (summary.id === DEFAULT_AGENT_ID && !agent?.description);
  const starters = agent?.starterPrompts ?? [];
  const { t } = useTranslation("chat");

  return (
    <Empty className="h-full">
      <EmptyHeader>
        {generic ? (
          <>
            <EmptyMedia variant="icon">
              <MessageCircleDashedIcon />
            </EmptyMedia>
            <EmptyTitle>{t("emptyChat.title")}</EmptyTitle>
            <EmptyDescription>
              {t("emptyChat.description", {
                location: workspaceDir ?? t("emptyChat.yourWorkspace"),
              })}
            </EmptyDescription>
          </>
        ) : (
          <>
            <EmptyMedia aria-hidden className="text-4xl">
              {summary.icon}
            </EmptyMedia>
            <EmptyTitle>{summary.name}</EmptyTitle>
            <EmptyDescription className="whitespace-pre-line">
              {agent?.description || t("emptyChat.title")}
            </EmptyDescription>
          </>
        )}
      </EmptyHeader>
      {starters.length > 0 && (
        <EmptyContent className="max-w-xl">
          <div className="flex flex-wrap justify-center gap-2">
            {starters.map((starter, index) => (
              <Button
                key={index}
                variant="outline"
                className="h-auto max-w-full py-2 text-left whitespace-normal"
                onClick={() => send(starter)}
              >
                {starter}
              </Button>
            ))}
          </div>
        </EmptyContent>
      )}
    </Empty>
  );
}
