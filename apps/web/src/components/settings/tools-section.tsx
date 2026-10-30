import * as React from "react";
import type { DesktopBridge, ToolPolicy, ToolSummary, ToolWarning } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Input } from "@workspace/ui/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import { ChevronRightIcon, SearchIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { SwitchRow } from "@/components/settings/option-group";
import { SectionHeading } from "@/components/settings/section-heading";
import { WebSearchPage } from "@/components/settings/web-search-page";
import {
  toolsQuery,
  useSetShellEnabled,
  useSetToolPolicy,
  useSetYoloMode,
  webSearchQuery,
} from "@/lib/extension-queries";
import { settingsQuery } from "@/lib/queries";

type T = TFunction<"extensions">;

function policyItems(t: T): { value: ToolPolicy; label: string }[] {
  return [
    { value: "auto", label: t("tools.policy.auto") },
    { value: "ask", label: t("tools.policy.ask") },
    { value: "allow", label: t("tools.policy.allow") },
    { value: "off", label: t("tools.policy.off") },
  ];
}

/** The shell never runs on `auto` or `off`: it asks, or runs freely after a warning. */
function shellPolicyItems(t: T): { value: ToolPolicy; label: string }[] {
  return [
    { value: "ask", label: t("tools.policy.ask") },
    { value: "allow", label: t("tools.policy.runWithoutAsking") },
  ];
}

function effectiveItems(t: T): { value: ToolSummary["effective"]; label: string }[] {
  return [
    { value: "allow", label: t("tools.policy.allow") },
    { value: "ask", label: t("tools.policy.ask") },
    { value: "off", label: t("tools.policy.off") },
  ];
}

const SHELL_TOOLS: Record<string, true> = { bash: true, powershell: true };

/** Tools that ship with the app have a plain name in the locale files (`tools.names.<name>`). */
const BUILT_IN_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "ls",
  "find",
  "grep",
  "bash",
  "powershell",
  "read_document",
  "current_datetime",
  "web_search",
  "web_fetch",
  "browser",
  "computer",
  "memory_save",
  "memory_list",
  "memory_search",
  "memory_forget",
  "todo_write",
  "delegate_task",
  "ask_user",
  "sessions",
  "schedule_manage",
  "office_read",
  "office_edit",
  "codemode",
  "tool_search",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
] as const;

function isBuiltInToolName(name: string): name is (typeof BUILT_IN_TOOL_NAMES)[number] {
  return (BUILT_IN_TOOL_NAMES as readonly string[]).includes(name);
}

/** Each warning code maps to the locale keys that word it. */
const WARNING_KEYS = {
  "shell-unrestricted": "tools.warnings.shellUnrestricted",
  "yolo-mode": "tools.warnings.yoloMode",
} as const satisfies Record<ToolWarning, string>;

/** Tools above this count get a search box. */
const SEARCH_THRESHOLD = 8;

/** Built-in tools have a plain name; MCP tools fall back to a tidied-up name. */
function friendlyName(tool: ToolSummary, t: T) {
  if (isBuiltInToolName(tool.name)) return t(`tools.names.${tool.name}`);
  let name = tool.name;
  const prefix = `${tool.source}_`;
  if (tool.source !== "built-in" && name.startsWith(prefix) && name.length > prefix.length) {
    name = name.slice(prefix.length);
  }
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function lockedReason(tool: ToolSummary, t: T) {
  if (SHELL_TOOLS[tool.name]) return t("tools.lockedReason.shell");
  return t("tools.lockedReason.default");
}

/** The kinds of built-in tools the page groups by. */
type ToolGroupKind = "files" | "documents" | "web" | "memory" | "shell" | "tasks" | "other";

/** What the built-in tools are for; a tool not listed here falls into the "other" group. */
const BUILT_IN_GROUPS: Record<string, ToolGroupKind> = {
  read: "files",
  write: "files",
  edit: "files",
  ls: "files",
  find: "files",
  grep: "files",
  read_document: "documents",
  office_read: "documents",
  office_edit: "documents",
  web_search: "web",
  web_fetch: "web",
  browser: "web",
  memory_save: "memory",
  memory_list: "memory",
  memory_search: "memory",
  memory_forget: "memory",
  bash: "shell",
  powershell: "shell",
  todo_write: "tasks",
  ask_user: "tasks",
  delegate_task: "tasks",
  sessions: "tasks",
  schedule_manage: "tasks",
};

/** Built-in group kinds in the order the page lists them; MCP servers follow, A–Z. */
const GROUP_ORDER = ["files", "documents", "web", "memory", "shell", "tasks", "other"];

interface ToolGroupData {
  /** Stable id for the open/closed state. */
  id: string;
  /** Built-in kind (`files`, `memory`, …), or null for an MCP server's tools. */
  kind: ToolGroupKind | null;
  /** MCP server name; only read when `kind` is null. */
  server: string;
  tools: ToolSummary[];
}

/** Built-in tools grouped by what they are for; the tools of each MCP server after them. */
function groupedTools(tools: ToolSummary[]): ToolGroupData[] {
  const groups = new Map<string, ToolGroupData>();
  for (const tool of tools) {
    const kind = tool.source === "built-in" ? (BUILT_IN_GROUPS[tool.name] ?? "other") : null;
    const id = kind ? `kind:${kind}` : `server:${tool.source}`;
    const group = groups.get(id) ?? { id, kind, server: tool.source, tools: [] };
    group.tools.push(tool);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => {
    const ra = a.kind ? GROUP_ORDER.indexOf(a.kind) : GROUP_ORDER.length;
    const rb = b.kind ? GROUP_ORDER.indexOf(b.kind) : GROUP_ORDER.length;
    return ra - rb || a.server.localeCompare(b.server);
  });
}

/**
 * One kind of tools behind a collapsed header, so a long tool list stays short. Search shows
 * groups open by default; a click always records the person's own choice.
 */
function ToolGroup({
  bridge,
  title,
  tools,
  intro,
  open,
  onOpenChange,
}: {
  bridge: DesktopBridge;
  title: string;
  tools: ToolSummary[];
  /** Settings that belong to this kind of tools, shown above its tool rows. */
  intro?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("extensions");
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase">
        <CollapsibleTrigger
          className={cn(
            "flex w-full cursor-pointer items-center gap-1.5 rounded-lg text-left outline-none",
            "hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30",
          )}
        >
          <ChevronRightIcon
            aria-hidden
            className="size-3 shrink-0 transition-transform data-[panel-open]:rotate-90"
          />
          <span className="truncate">{title}</span>
          <span className="shrink-0 font-normal normal-case tabular-nums">
            {` · ${t("tools.groupCount", { count: tools.length })}`}
          </span>
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent className="flex flex-col gap-2.5">
        {intro}
        <ItemGroup>
          {tools.map((tool) => (
            <ToolRow key={tool.name} bridge={bridge} tool={tool} />
          ))}
        </ItemGroup>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A single switch that makes every tool run without asking, as if each had policy "allow" (the
 * shell too, once its own master switch is on). It does not turn off tools, or re-enable the
 * shell: Settings › Tools and "Allow shell commands" still decide what the agent can reach at
 * all, yolo mode only removes the approval step for what is already allowed.
 */
function YoloModeSettings({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("extensions");
  const settings = useQuery(settingsQuery(bridge));
  const setYolo = useSetYoloMode(bridge);
  const checked = setYolo.isPending
    ? (setYolo.variables ?? false)
    : (settings.data?.yoloMode ?? false);

  async function onCheckedChange(value: boolean) {
    if (value) {
      const confirmed = await ConfirmModal.show({
        title: t("tools.yolo.confirm.title"),
        description: t("tools.yolo.confirm.description"),
        confirmLabel: t("tools.yolo.enable.label"),
      });
      if (!confirmed) return;
    }
    setYolo.mutate(value);
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border/70 p-3">
      <SwitchRow
        id="yolo-mode"
        label={t("tools.yolo.enable.label")}
        description={t("tools.yolo.enable.description")}
        checked={checked}
        disabled={settings.isPending || setYolo.isPending}
        onCheckedChange={(value) => void onCheckedChange(value)}
      />
      {checked && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t(`${WARNING_KEYS["yolo-mode"]}.title`)}</AlertTitle>
          <AlertDescription>{t(`${WARNING_KEYS["yolo-mode"]}.message`)}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** The master switch for shell commands, shown above the shell tools in their group. */
function ShellSettings({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("extensions");
  const settings = useQuery(settingsQuery(bridge));
  const tools = useQuery(toolsQuery(bridge));
  const setShell = useSetShellEnabled(bridge);
  const checked = setShell.isPending
    ? (setShell.variables ?? false)
    : (settings.data?.shellEnabled ?? false);
  const warning = tools.data?.find((tool) => SHELL_TOOLS[tool.name] && tool.warning)?.warning;
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm text-muted-foreground">{t("tools.shell.description")}</p>
      <SwitchRow
        id="shell-enabled"
        label={t("tools.shell.enable.label")}
        description={t("tools.shell.enable.description")}
        checked={checked}
        disabled={settings.isPending || setShell.isPending}
        onCheckedChange={(value) => setShell.mutate(value)}
      />
      {warning && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t(`${WARNING_KEYS[warning]}.title`)}</AlertTitle>
          <AlertDescription>{t(`${WARNING_KEYS[warning]}.message`)}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** Compact stand-in for the full configuration, which lives in its own page. */
function WebSearchRow({ bridge, onOpen }: { bridge: DesktopBridge; onOpen: () => void }) {
  const { t } = useTranslation("extensions");
  const query = useQuery(webSearchQuery(bridge));
  const providers = query.data?.providers ?? [];
  const enabled = providers.filter((provider) => provider.enabled);
  const needsSetup = enabled.some(
    (provider) =>
      (provider.keyRequired && !provider.hasKey) ||
      (provider.endpointRequired && provider.endpoint.trim() === ""),
  );

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <SearchIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {t("webSearch.title")}
          {enabled.length > 0 && needsSetup && (
            <Badge variant="destructive">{t("webSearch.needsSetup")}</Badge>
          )}
        </ItemTitle>
        <ItemDescription>
          {query.isPending ? (
            <Skeleton className="h-4 w-40" />
          ) : enabled.length > 0 ? (
            t("webSearch.summary", {
              providers: enabled.map((provider) => provider.label).join(", "),
            })
          ) : (
            t("webSearch.summaryEmpty")
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm" disabled={query.isPending} onClick={onOpen}>
          {enabled.length > 0 ? t("webSearch.manage") : t("webSearch.setUp")}
        </Button>
      </ItemActions>
    </Item>
  );
}

function PolicyControl({ bridge, tool }: { bridge: DesktopBridge; tool: ToolSummary }) {
  const { t } = useTranslation("extensions");
  const setPolicy = useSetToolPolicy(bridge);
  const label = t("tools.policyLabel", { name: friendlyName(tool, t) });

  if (tool.locked) {
    const items = effectiveItems(t);
    return (
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
          <Select items={items} value={tool.effective} disabled>
            <SelectTrigger size="sm" className="w-36" aria-label={label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TooltipTrigger>
        <TooltipContent>{lockedReason(tool, t)}</TooltipContent>
      </Tooltip>
    );
  }

  const isShell = SHELL_TOOLS[tool.name] === true;
  const items = isShell ? shellPolicyItems(t) : policyItems(t);

  async function onChange(policy: ToolPolicy) {
    if (isShell && policy === "allow") {
      const confirmed = await ConfirmModal.show({
        title: t("tools.shell.confirm.title"),
        description: t("tools.shell.confirm.description"),
        confirmLabel: t("tools.policy.runWithoutAsking"),
      });
      if (!confirmed) return;
    }
    setPolicy.mutate({ name: tool.name, policy });
  }

  return (
    <Select
      items={items}
      value={tool.policy}
      onValueChange={(policy) => policy && void onChange(policy)}
    >
      <SelectTrigger size="sm" className="w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ToolRow({ bridge, tool }: { bridge: DesktopBridge; tool: ToolSummary }) {
  const { t } = useTranslation("extensions");
  const title = friendlyName(tool, t);
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle>
          {title}
          {title !== tool.name && (
            <span className="font-mono text-xs font-normal text-muted-foreground">{tool.name}</span>
          )}
        </ItemTitle>
        {tool.description && (
          <ItemDescription className="line-clamp-2 text-xs">{tool.description}</ItemDescription>
        )}
        {tool.locked && (
          <ItemDescription className="text-xs">{lockedReason(tool, t)}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        <PolicyControl bridge={bridge} tool={tool} />
      </ItemActions>
    </Item>
  );
}

function ToolsSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-2xl" />
      ))}
    </div>
  );
}

/** The web search configuration opens as its own page, like a Channels setup page. */
type View = { kind: "list" } | { kind: "webSearch" };

export function ToolsSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("extensions");
  const tools = useQuery(toolsQuery(bridge));
  const [search, setSearch] = React.useState("");
  /** Per-group open state; untouched groups stay collapsed, or open while searching. */
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const [view, setView] = React.useState<View>({ kind: "list" });

  if (view.kind === "webSearch") return <WebSearchPage bridge={bridge} />;

  const all = tools.data ?? [];
  const query = search.trim().toLowerCase();
  const groups = groupedTools(all).map((group) => {
    const title = group.kind ? t(`tools.groups.${group.kind}`) : group.server;
    const tools = query
      ? group.tools.filter((tool) =>
          [friendlyName(tool, t), tool.name, tool.description, title].some((text) =>
            text.toLowerCase().includes(query),
          ),
        )
      : group.tools;
    return { ...group, title, tools };
  });
  const filtered = groups.filter((group) => group.tools.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title={t("tools.heading.title")}
        description={t("tools.heading.description")}
      />

      <p className="text-sm text-muted-foreground">
        <Trans
          t={t}
          i18nKey="tools.policyHelp"
          components={{ strong: <strong className="font-medium text-foreground" /> }}
        />
      </p>

      <YoloModeSettings bridge={bridge} />

      {tools.isPending ? (
        <ToolsSkeleton />
      ) : tools.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("tools.loadError")}</AlertTitle>
          <AlertDescription>{tools.error.message}</AlertDescription>
        </Alert>
      ) : all.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WrenchIcon />
            </EmptyMedia>
            <EmptyTitle>{t("tools.empty.title")}</EmptyTitle>
            <EmptyDescription>{t("tools.empty.description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {all.length > SEARCH_THRESHOLD && (
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("tools.search.placeholder")}
                aria-label={t("tools.search.label")}
                className="pl-9"
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("tools.noMatch", { query: search.trim() })}
            </p>
          ) : (
            filtered.map((group) => (
              <ToolGroup
                key={group.id}
                bridge={bridge}
                title={group.title}
                tools={group.tools}
                intro={
                  group.kind === "shell" ? (
                    <ShellSettings bridge={bridge} />
                  ) : group.kind === "web" ? (
                    <ItemGroup>
                      <WebSearchRow bridge={bridge} onOpen={() => setView({ kind: "webSearch" })} />
                    </ItemGroup>
                  ) : undefined
                }
                open={openGroups[group.id] ?? query !== ""}
                onOpenChange={(next) => setOpenGroups((state) => ({ ...state, [group.id]: next }))}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
