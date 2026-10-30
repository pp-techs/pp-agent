import * as React from "react";
import { DEFAULT_AGENT_ID, type DesktopBridge } from "@workspace/shared";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { skillsQuery, workspaceSkillsQuery } from "@/lib/extension-queries";
import { agentsQuery, useAgentCommands } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";
import { goalStatusKey } from "@/lib/goal";
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
 * or found in the workspace's .agents/skills, and allowed by the agent). Commands run in the app; skills are expanded by the agent when sent.
 */
export function useSlashItems(bridge: DesktopBridge): {
  commands: SlashItem[];
  skills: SlashItem[];
} {
  const running = useChatStore((state) => state.status === "running");
  const agentId = useChatStore((state) => state.agent?.id ?? DEFAULT_AGENT_ID);
  const workspaceDir = useChatStore((state) => state.workspaceDir);
  const skills = useQuery(skillsQuery(bridge));
  const workspaceSkills = useQuery(workspaceSkillsQuery(bridge, workspaceDir));
  const agents = useQuery(agentsQuery(bridge));
  const { newChat, compact, setConversationYolo } = useAgentCommands(bridge);
  const yolo = useChatStore((state) => state.yolo);
  const goal = useChatStore((state) => state.goal);
  const { t } = useTranslation("chat");

  const commands = React.useMemo<SlashItem[]>(() => {
    const onError = (error: Error) => toast.error(error.message);
    return [
      {
        kind: "command",
        name: "new",
        label: t("slash.commands.new.label"),
        description: t("slash.commands.new.description"),
        run: () => newChat.mutate(undefined, { onError }),
      },
      {
        kind: "command",
        name: "compact",
        label: t("slash.commands.compact.label"),
        description: t("slash.commands.compact.description"),
        run: () => {
          if (running) {
            toast.info(t("waitForAnswer"));
            return;
          }
          toast.promise(compact.mutateAsync(), {
            loading: t("slash.commands.compact.loading"),
            success: t("slash.commands.compact.success"),
            error: (error: Error) => error.message,
          });
        },
      },
      {
        kind: "command",
        name: "yolo",
        label: yolo.active ? t("slash.commands.yolo.labelOff") : t("slash.commands.yolo.labelOn"),
        description:
          yolo.source === "settings"
            ? t("header.yolo.lockedBySettings")
            : t("slash.commands.yolo.description"),
        run: () => {
          if (yolo.source === "settings") {
            toast.info(t("header.yolo.lockedBySettings"));
            return;
          }
          void (async () => {
            if (!yolo.active) {
              const confirmed = await ConfirmModal.show({
                title: t("header.yolo.confirm.title"),
                description: t("header.yolo.confirm.description"),
                confirmLabel: t("header.yolo.on"),
              });
              if (!confirmed) return;
            }
            setConversationYolo.mutate(!yolo.active, { onError });
          })();
        },
      },
      {
        kind: "command",
        name: "goal",
        label: t("slash.commands.goal.label"),
        description: t("slash.commands.goal.description"),
        run: () => {
          if (goal) {
            toast.info(
              t("slash.commands.goal.current", {
                status: t(goalStatusKey(goal)),
                objective: goal.objective,
              }),
            );
            return;
          }
          // The objective follows the command in the same message.
          useComposerStore.getState().setDraft("/goal ");
        },
      },
    ];
  }, [newChat, compact, setConversationYolo, yolo, goal, running, t]);

  const available = React.useMemo<SlashItem[]>(() => {
    const allowed = agents.data?.find((agent) => agent.id === agentId)?.skills ?? null;
    // The workspace's own skills are always on and win over an installed one of the same name, as
    // in the agent; installed ones follow the agent's skill list.
    const own = workspaceSkills.data ?? [];
    const installed = (skills.data ?? []).filter(
      (skill) =>
        !own.some((other) => other.name === skill.name) &&
        (allowed === null || allowed.includes(skill.name)),
    );
    return [...own, ...installed]
      .filter((skill) => skill.enabled)
      .map((skill) => ({
        kind: "skill",
        name: skill.name,
        label: skill.name,
        description: skill.description,
      }));
  }, [skills.data, workspaceSkills.data, agents.data, agentId]);

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
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea[data-composer-input]");
    if (!textarea) return;
    textarea.focus();
    const end = useComposerStore.getState().draft.length;
    textarea.setSelectionRange(end, end);
  });
}
