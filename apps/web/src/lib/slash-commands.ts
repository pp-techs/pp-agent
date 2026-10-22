import * as React from "react";
import { DEFAULT_AGENT_ID, type DesktopBridge } from "@workspace/shared";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { skillsQuery } from "@/lib/extension-queries";
import { agentsQuery, useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";
import { useComposerStore } from "@/stores/composer-store";

/** Something the person can pick after typing `/`, or from the composer's + menu. */
export type SlashItem =
  | { kind: "command"; name: string; label: string; description: string; run: () => void }
  | { kind: "skill"; name: string; label: string; description: string };

/** What a picked item puts in the message box: a skill becomes `/skill:<name> `. */
export function slashText(item: SlashItem): string {
  return item.kind === "skill" ? `/skill:${item.name} ` : `/${item.name}`;
}

/**
 * App commands and the skills the open conversation's agent may use (enabled in Settings › Skills
 * and allowed by the agent). Commands run in the app; skills are expanded by the agent when sent.
 */
export function useSlashItems(bridge: DesktopBridge): {
  commands: SlashItem[];
  skills: SlashItem[];
} {
  const running = useChatStore((state) => state.status === "running");
  const agentId = useChatStore((state) => state.agent?.id ?? DEFAULT_AGENT_ID);
  const skills = useQuery(skillsQuery(bridge));
  const agents = useQuery(agentsQuery(bridge));
  const { newChat, compact } = useAgentCommands(bridge);

  const commands = React.useMemo<SlashItem[]>(() => {
    const onError = (error: Error) => toast.error(error.message);
    return [
      {
        kind: "command",
        name: "new",
        label: "New chat",
        description: "Start a fresh conversation.",
        run: () => newChat.mutate(undefined, { onError }),
      },
      {
        kind: "command",
        name: "compact",
        label: "Summarize the chat so far",
        description: "Frees up room in long conversations; the agent keeps a summary.",
        run: () => {
          if (running) {
            toast.info("Wait for the answer to finish.");
            return;
          }
          toast.promise(compact.mutateAsync(), {
            loading: "Summarizing the conversation…",
            success: "Conversation summarized",
            error: (error: Error) => error.message,
          });
        },
      },
    ];
  }, [newChat, compact, running]);

  const available = React.useMemo<SlashItem[]>(() => {
    const allowed = agents.data?.find((agent) => agent.id === agentId)?.skills ?? null;
    return (skills.data ?? [])
      .filter((skill) => skill.enabled && (allowed === null || allowed.includes(skill.name)))
      .map((skill) => ({
        kind: "skill",
        name: skill.name,
        label: skill.name,
        description: skill.description,
      }));
  }, [skills.data, agents.data, agentId]);

  return { commands, skills: available };
}

/**
 * The `/` token being typed when the whole message so far is one (`/sk`, `/skill:mi`), else null.
 * Suggestions stop once a space follows the command.
 */
export function slashQuery(draft: string): string | null {
  const match = /^\/(\S*)$/.exec(draft);
  return match ? (match[1] ?? "").toLowerCase() : null;
}

/** Items matching `query`; prefix matches of the name come first. */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const needle = query.replace(/^skill:/, "");
  const scored = items.flatMap((item) => {
    const name = item.name.toLowerCase();
    const haystack = `${name} ${item.label.toLowerCase()} ${item.description.toLowerCase()}`;
    if (query.startsWith("skill:") && item.kind !== "skill") return [];
    if (name.startsWith(needle)) return [{ item, score: 0 }];
    if (haystack.includes(needle)) return [{ item, score: 1 }];
    return [];
  });
  return scored.sort((a, b) => a.score - b.score).map(({ item }) => item);
}

/** Runs a command typed in full (`/new`), so Enter works without picking it from the list. */
export function findTypedCommand(items: SlashItem[], draft: string): SlashItem | undefined {
  const typed = draft.trim().toLowerCase();
  return items.find((item) => item.kind === "command" && `/${item.name}` === typed);
}

/** Keeps the message box focused after a menu or list closes. */
export function focusComposer(): void {
  requestAnimationFrame(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Message']");
    if (!textarea) return;
    textarea.focus();
    const end = useComposerStore.getState().draft.length;
    textarea.setSelectionRange(end, end);
  });
}
