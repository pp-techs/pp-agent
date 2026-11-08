import * as React from "react";
import { DEFAULT_AGENT_ID, type DesktopBridge } from "@workspace/shared";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { skillsQuery, workspaceSkillsQuery } from "@/lib/extension-queries";
import { confirmLeaveTemporary } from "@/lib/confirm-leave-temporary";
import {
  agentsQuery,
  useCompact,
  useNewChat,
  useNewTemporaryChat,
  useSetConversationYolo,
} from "@/lib/queries";
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

/** Commands that stay in the message box and take text after them (`/goal <objective>`). */
const COMMANDS_WITH_TEXT = ["goal", "research"];

export type LeadingToken = { kind: SlashItem["kind"]; name: string };

/**
 * The skills (or the one command) a message starts with, which the message box shows as chips
 * instead of raw `/skill:abc `. `prefix` is the exact start of the draft they stand for; the text
 * after it is what the person types. Only picked or fully typed ones count: a skill must exist, and
 * the space after it is typed. Several skills may follow each other; a command stands alone.
 */
export function leadingTokens(
  draft: string,
  skills: SlashItem[],
): { tokens: LeadingToken[]; prefix: string } {
  const tokens: LeadingToken[] = [];
  let prefix = "";
  let rest = draft;
  for (let match = /^\/skill:(\S+) +/.exec(rest); match; match = /^\/skill:(\S+) +/.exec(rest)) {
    const name = match[1] ?? "";
    if (!skills.some((item) => item.name === name)) break;
    tokens.push({ kind: "skill", name });
    prefix += match[0];
    rest = rest.slice(match[0].length);
  }
  if (tokens.length > 0) return { tokens, prefix };
  const command = COMMANDS_WITH_TEXT.find((name) => draft.startsWith(`/${name} `));
  return command
    ? { tokens: [{ kind: "command", name: command }], prefix: `/${command} ` }
    : { tokens, prefix };
}

/** The draft's start for `tokens`, as `leadingTokens` reads it back. */
export function tokensPrefix(tokens: LeadingToken[]): string {
  return tokens
    .map((token) => (token.kind === "skill" ? `/skill:${token.name} ` : `/${token.name} `))
    .join("");
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
  // `mutate` and `mutateAsync` keep their identity across renders, so the list is only rebuilt
  // when what it shows changes.
  const { mutate: newChat } = useNewChat(bridge);
  const { mutate: newTemporaryChat } = useNewTemporaryChat(bridge);
  const { mutateAsync: compact } = useCompact(bridge);
  const { mutate: setConversationYolo } = useSetConversationYolo(bridge);
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
        run: () => void confirmLeaveTemporary().then((ok) => ok && newChat(undefined, { onError })),
      },
      {
        kind: "command",
        name: "temp",
        label: t("slash.commands.temp.label"),
        description: t("slash.commands.temp.description"),
        run: () =>
          void confirmLeaveTemporary().then((ok) => ok && newTemporaryChat(undefined, { onError })),
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
          toast.promise(compact(), {
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
            setConversationYolo(!yolo.active, { onError });
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
      {
        kind: "command",
        name: "research",
        label: t("slash.commands.research.label"),
        description: t("slash.commands.research.description"),
        run: () => useComposerStore.getState().setDraft("/research "),
      },
    ];
  }, [newChat, newTemporaryChat, compact, setConversationYolo, yolo, goal, running, t]);

  const available = React.useMemo<SlashItem[]>(() => {
    const allowed = agents.data?.find((agent) => agent.id === agentId)?.skills ?? null;
    // Installed and the workspace's own skills both follow the agent's skill list. The agent
    // reports only workspace skills that load, never one named like an installed skill.
    return [...(workspaceSkills.data ?? []), ...(skills.data ?? [])]
      .filter((skill) => skill.enabled && (allowed === null || allowed.includes(skill.name)))
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
