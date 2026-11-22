import * as React from "react";
import type { RunSpan } from "@workspace/shared";
import {
  BotIcon,
  BrainIcon,
  CalendarIcon,
  CircleHelpIcon,
  FileTextIcon,
  FlagIcon,
  FolderIcon,
  GitForkIcon,
  GlobeIcon,
  ListChecksIcon,
  type LucideIcon,
  MailIcon,
  MessageSquareIcon,
  MonitorIcon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";

import type { CardRole } from "@/components/run/flow-layout";

/** An icon that says what kind of tool a call is, from its name. */
export function toolIcon(name: string): LucideIcon {
  const tool = name.toLowerCase();
  if (tool === "delegate_task") return GitForkIcon;
  if (tool === "read" || tool.includes("document")) return FileTextIcon;
  if (tool === "write" || tool === "edit") return PencilIcon;
  if (tool === "ls" || tool === "find") return FolderIcon;
  if (tool === "grep" || tool.includes("search")) return SearchIcon;
  if (tool === "bash" || tool.includes("shell")) return TerminalIcon;
  if (tool.includes("web") || tool.includes("fetch") || tool === "browser") return GlobeIcon;
  if (tool === "computer") return MonitorIcon;
  if (tool.includes("todo")) return ListChecksIcon;
  if (tool.includes("memory")) return BrainIcon;
  if (tool.includes("email")) return MailIcon;
  if (tool.includes("schedule")) return CalendarIcon;
  if (tool === "ask_user") return CircleHelpIcon;
  return WrenchIcon;
}

export function cardIcon(role: CardRole, span: RunSpan): LucideIcon {
  switch (role) {
    case "start":
      return MessageSquareIcon;
    case "end":
      return FlagIcon;
    case "agent":
      return BotIcon;
    case "step":
      return SparklesIcon;
    case "tool":
    case "more":
      return toolIcon(span.name);
  }
}

/** The icon of a card, rendered (a component picked during render would remount every time). */
export function CardIcon({
  role,
  span,
  ...props
}: { role: CardRole; span: RunSpan } & React.ComponentProps<LucideIcon>) {
  return React.createElement(cardIcon(role, span), props);
}
