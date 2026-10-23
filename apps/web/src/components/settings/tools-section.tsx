import * as React from "react";
import type { DesktopBridge, ToolPolicy, ToolSummary } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
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
import { useQuery } from "@tanstack/react-query";
import { SearchIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { OptionGroup, SwitchRow } from "@/components/settings/option-group";
import { SectionHeading } from "@/components/settings/section-heading";
import { WebSearchGroup } from "@/components/settings/web-search-group";
import { toolsQuery, useSetShellEnabled, useSetToolPolicy } from "@/lib/extension-queries";
import { settingsQuery } from "@/lib/queries";

const POLICY_ITEMS: { value: ToolPolicy; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "ask", label: "Always ask" },
  { value: "allow", label: "Always allow" },
  { value: "off", label: "Off" },
];

/** The shell never runs on `auto` or `off`: it asks, or runs freely after a warning. */
const SHELL_POLICY_ITEMS: { value: ToolPolicy; label: string }[] = [
  { value: "ask", label: "Always ask" },
  { value: "allow", label: "Run without asking" },
];

const EFFECTIVE_ITEMS: { value: ToolSummary["effective"]; label: string }[] = [
  { value: "allow", label: "Always allow" },
  { value: "ask", label: "Always ask" },
  { value: "off", label: "Off" },
];

const SHELL_TOOLS: Record<string, true> = { bash: true, powershell: true };

/** Plain names for the tools that ship with the app; MCP tools fall back to a tidied-up name. */
const FRIENDLY_NAMES: Record<string, string> = {
  read: "Read files",
  write: "Create and save files",
  edit: "Edit parts of files",
  ls: "List folders",
  find: "Find files by name",
  grep: "Search inside files",
  bash: "Run shell commands",
  powershell: "Run PowerShell commands",
  read_document: "Read documents (Word, Excel, PDF…)",
  current_datetime: "Current date and time",
  web_search: "Search the web",
  web_fetch: "Open web pages",
  codemode: "Run scripts with connected tools",
  tool_search: "Look up connected tools",
  list_mcp_resources: "List server resources",
  list_mcp_resource_templates: "List server resource templates",
  read_mcp_resource: "Read server resources",
};

/** Tools above this count get a search box. */
const SEARCH_THRESHOLD = 8;

function friendlyName(tool: ToolSummary) {
  const known = FRIENDLY_NAMES[tool.name];
  if (known) return known;
  let name = tool.name;
  const prefix = `${tool.source}_`;
  if (tool.source !== "built-in" && name.startsWith(prefix) && name.length > prefix.length) {
    name = name.slice(prefix.length);
  }
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function lockedReason(tool: ToolSummary) {
  if (SHELL_TOOLS[tool.name]) return "Turn on “Allow shell commands” above to use this.";
  return "Always on. Each tool it reaches is checked on its own.";
}

/** Built-in first, then each MCP server alphabetically. */
function groupBySource(tools: ToolSummary[]) {
  const groups = new Map<string, ToolSummary[]>();
  for (const tool of tools) {
    const list = groups.get(tool.source) ?? [];
    list.push(tool);
    groups.set(tool.source, list);
  }
  return [...groups].sort(([a], [b]) => {
    if (a === "built-in") return -1;
    if (b === "built-in") return 1;
    return a.localeCompare(b);
  });
}

function ShellGroup({ bridge }: { bridge: DesktopBridge }) {
  const settings = useQuery(settingsQuery(bridge));
  const tools = useQuery(toolsQuery(bridge));
  const setShell = useSetShellEnabled(bridge);
  const checked = setShell.isPending
    ? (setShell.variables ?? false)
    : (settings.data?.shellEnabled ?? false);
  const warning = tools.data?.find((tool) => SHELL_TOOLS[tool.name] && tool.warning)?.warning;
  return (
    <OptionGroup
      legend="Shell commands"
      description="Lets the agent run commands on your computer (Terminal on Mac, PowerShell on Windows)."
    >
      <SwitchRow
        id="shell-enabled"
        label="Allow shell commands"
        description="It asks you before every command unless you choose “Run without asking” in the list below. Commands can change or delete files, so only approve ones you understand."
        checked={checked}
        disabled={settings.isPending || setShell.isPending}
        onCheckedChange={(value) => setShell.mutate(value)}
      />
      {warning && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Shell commands run without asking</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}
    </OptionGroup>
  );
}

function PolicyControl({ bridge, tool }: { bridge: DesktopBridge; tool: ToolSummary }) {
  const setPolicy = useSetToolPolicy(bridge);
  const label = `When the agent wants to use “${friendlyName(tool)}”`;

  if (tool.locked) {
    return (
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
          <Select items={EFFECTIVE_ITEMS} value={tool.effective} disabled>
            <SelectTrigger size="sm" className="w-36" aria-label={label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EFFECTIVE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TooltipTrigger>
        <TooltipContent>{lockedReason(tool)}</TooltipContent>
      </Tooltip>
    );
  }

  const isShell = SHELL_TOOLS[tool.name] === true;
  const items = isShell ? SHELL_POLICY_ITEMS : POLICY_ITEMS;

  async function onChange(policy: ToolPolicy) {
    if (isShell && policy === "allow") {
      const confirmed = await ConfirmModal.show({
        title: "Run shell commands without asking?",
        description:
          "The agent will run every command right away, without showing it to you first. Commands can change or delete files and send data out of this computer. Only turn this on if you trust the agent, the model and the content it reads.",
        confirmLabel: "Run without asking",
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
  const title = friendlyName(tool);
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
        {tool.locked && <ItemDescription className="text-xs">{lockedReason(tool)}</ItemDescription>}
        {tool.warning && (
          <ItemDescription className="flex items-center gap-1 text-xs text-destructive">
            <TriangleAlertIcon className="size-3 shrink-0" />
            {tool.warning}
          </ItemDescription>
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

export function ToolsSection({ bridge }: { bridge: DesktopBridge }) {
  const tools = useQuery(toolsQuery(bridge));
  const [search, setSearch] = React.useState("");

  const all = tools.data ?? [];
  const query = search.trim().toLowerCase();
  const filtered = query
    ? all.filter((tool) =>
        [friendlyName(tool), tool.name, tool.description, tool.source].some((text) =>
          text.toLowerCase().includes(query),
        ),
      )
    : all;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Tools"
        description="Choose what the agent may do on its own and what it must ask you about first."
      />

      <ShellGroup bridge={bridge} />

      <WebSearchGroup bridge={bridge} />

      <p className="text-sm text-muted-foreground">
        <strong className="font-medium text-foreground">Automatic</strong> lets tools that only look
        at things run freely and asks before anything that changes something.{" "}
        <strong className="font-medium text-foreground">Off</strong> hides the tool from the agent
        completely.
      </p>

      {tools.isPending ? (
        <ToolsSkeleton />
      ) : tools.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Couldn't load the tools</AlertTitle>
          <AlertDescription>{tools.error.message}</AlertDescription>
        </Alert>
      ) : all.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WrenchIcon />
            </EmptyMedia>
            <EmptyTitle>No tools yet</EmptyTitle>
            <EmptyDescription>
              Tools appear here once the agent has started. Connect business systems under MCP
              servers.
            </EmptyDescription>
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
                placeholder="Search tools"
                aria-label="Search tools"
                className="pl-9"
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tools match “{search.trim()}”.</p>
          ) : (
            groupBySource(filtered).map(([source, list]) => (
              <section key={source} className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase">
                  {source === "built-in" ? "Built-in" : source}
                </h3>
                <ItemGroup>
                  {list.map((tool) => (
                    <ToolRow key={tool.name} bridge={bridge} tool={tool} />
                  ))}
                </ItemGroup>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}
