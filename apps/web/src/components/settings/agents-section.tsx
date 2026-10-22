import * as React from "react";
import { DEFAULT_AGENT_ID, type AgentProfile, type DesktopBridge } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import {
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  ShareIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { AgentEditor } from "@/components/settings/agent-editor";
import { SectionHeading } from "@/components/settings/section-heading";
import { useDeleteAgent, useImportAgent, useSaveAgent } from "@/lib/extension-queries";
import { modelKey } from "@/lib/models";
import { agentsQuery, modelsQuery } from "@/lib/queries";

type View = { kind: "list" } | { kind: "edit"; id?: string };

/** "Sales copy", then "Sales copy 2", "Sales copy 3"… until the name is free. */
function copyName(name: string, agents: AgentProfile[]) {
  const taken = new Set(agents.map((agent) => agent.name.toLowerCase()));
  const base = `${name} copy`.slice(0, 54);
  let candidate = base;
  for (let index = 2; taken.has(candidate.toLowerCase()); index++) {
    candidate = `${base} ${index}`;
  }
  return candidate;
}

/** File name for an exported agent: letters, digits, spaces, and hyphens only. */
const exportFileName = (name: string) => name.replace(/[^\p{L}\p{N} -]+/gu, "").trim() || "agent";

function AgentRow({
  bridge,
  agent,
  agents,
  onEdit,
}: {
  bridge: DesktopBridge;
  agent: AgentProfile;
  agents: AgentProfile[];
  onEdit: () => void;
}) {
  const models = useQuery(modelsQuery(bridge));
  const save = useSaveAgent(bridge);
  const remove = useDeleteAgent(bridge);
  const [exporting, setExporting] = React.useState(false);
  const isDefault = agent.id === DEFAULT_AGENT_ID;
  const agentModel = agent.model;
  const model = agentModel
    ? models.data?.find((item) => modelKey(item) === modelKey(agentModel))
    : undefined;
  const busy = save.isPending || remove.isPending || exporting;

  function onDuplicate() {
    const { id: _id, ...rest } = agent;
    save.mutate(
      { ...rest, name: copyName(agent.name, agents) },
      {
        onSuccess: (copy) => toast.success(`Agent “${copy.name}” added`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  async function onExport() {
    setExporting(true);
    try {
      const json = await bridge.agent.command({ type: "export_agent", id: agent.id });
      const saved = await bridge.files.saveAgentFile(exportFileName(agent.name), json);
      if (saved) toast.success(`Agent “${agent.name}” exported`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  async function onDelete() {
    const confirmed = await ConfirmModal.show({
      title: "Delete this agent?",
      description: `“${agent.name}” will be removed. Chats that used it switch to ${agents[0]?.name ?? "the default agent"}. Files in its workspace stay where they are.`,
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    remove.mutate(agent.id, {
      onSuccess: () => toast.success(`Agent “${agent.name}” deleted`),
    });
  }

  return (
    <Item variant="outline" size="sm">
      <ItemMedia aria-hidden className="text-2xl">
        {agent.icon}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          {agent.name}
          {isDefault && <Badge variant="secondary">Default</Badge>}
          {agentModel && (
            <Badge variant="outline" title="Switches the chat to this model">
              {model?.name ?? `${agentModel.modelId} (not available)`}
            </Badge>
          )}
        </ItemTitle>
        {agent.description && (
          <ItemDescription className="line-clamp-2">{agent.description}</ItemDescription>
        )}
      </ItemContent>
      <ItemActions>
        {busy && <Spinner />}
        <Button variant="outline" size="sm" onClick={onEdit}>
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${agent.name}`} />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={busy} onClick={onDuplicate}>
              <CopyIcon />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onClick={() => void onExport()}>
              <ShareIcon />
              Export
            </DropdownMenuItem>
            {!isDefault && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void onDelete()}
                >
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}

export function AgentsSection({ bridge }: { bridge: DesktopBridge }) {
  const agents = useQuery(agentsQuery(bridge));
  const importAgent = useImportAgent(bridge);
  const [view, setView] = React.useState<View>({ kind: "list" });

  if (view.kind === "edit") {
    return <AgentEditor bridge={bridge} id={view.id} onDone={() => setView({ kind: "list" })} />;
  }

  async function onImport() {
    let json: string | null;
    try {
      json = await bridge.files.openAgentFile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return;
    }
    if (json === null) return;
    importAgent.mutate(json, {
      onSuccess: (agent) => toast.success(`Agent “${agent.name}” added`),
    });
  }

  const list = agents.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Agents"
        description="Assistants set up for a kind of work: their own rules, tools, skills, model, and folder. Pick one for each chat from the message box."
      >
        <Button variant="outline" disabled={importAgent.isPending} onClick={() => void onImport()}>
          {importAgent.isPending ? <Spinner /> : <DownloadIcon />}
          Import
        </Button>
        <Button onClick={() => setView({ kind: "edit" })}>
          <PlusIcon />
          New agent
        </Button>
      </SectionHeading>

      {agents.isPending ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : agents.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Couldn't load your agents</AlertTitle>
          <AlertDescription>{agents.error.message}</AlertDescription>
        </Alert>
      ) : (
        <ItemGroup>
          {list.map((agent) => (
            <AgentRow
              key={agent.id}
              bridge={bridge}
              agent={agent}
              agents={list}
              onEdit={() => setView({ kind: "edit", id: agent.id })}
            />
          ))}
        </ItemGroup>
      )}
    </div>
  );
}
