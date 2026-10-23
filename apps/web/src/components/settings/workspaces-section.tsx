import * as React from "react";
import { DEFAULT_WORKSPACE_ID, type DesktopBridge, type WorkspaceProfile } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
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
import { PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { SectionHeading } from "@/components/settings/section-heading";
import { WorkspaceEditor } from "@/components/settings/workspace-editor";
import { useDeleteWorkspace } from "@/lib/extension-queries";
import { workspacesQuery } from "@/lib/queries";

type View = { kind: "list" } | { kind: "edit"; id?: string };

function WorkspaceRow({
  bridge,
  workspace,
  onEdit,
}: {
  bridge: DesktopBridge;
  workspace: WorkspaceProfile;
  onEdit: () => void;
}) {
  const remove = useDeleteWorkspace(bridge);
  const isDefault = workspace.id === DEFAULT_WORKSPACE_ID;

  async function onDelete() {
    const confirmed = await ConfirmModal.show({
      title: "Delete this workspace?",
      description: `“${workspace.name}” will be removed. Its chats move to the built-in workspace, and its files stay in the folder.`,
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    remove.mutate(workspace.id, {
      onSuccess: () => toast.success(`Workspace “${workspace.name}” deleted`),
    });
  }

  return (
    <Item variant="outline" size="sm">
      <ItemMedia aria-hidden className="text-2xl">
        {workspace.icon}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          {workspace.name}
          {isDefault && <Badge variant="secondary">Built-in</Badge>}
        </ItemTitle>
        <ItemDescription className="truncate font-mono text-xs" title={workspace.dir ?? undefined}>
          {workspace.dir ?? "The app's default workspace folder"}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {remove.isPending && <Spinner />}
        <Button variant="outline" size="sm" onClick={onEdit}>
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
        {!isDefault && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${workspace.name}`}
            disabled={remove.isPending}
            onClick={() => void onDelete()}
          >
            <Trash2Icon />
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

export function WorkspacesSection({ bridge }: { bridge: DesktopBridge }) {
  const workspaces = useQuery(workspacesQuery(bridge));
  const [view, setView] = React.useState<View>({ kind: "list" });

  if (view.kind === "edit") {
    return (
      <WorkspaceEditor bridge={bridge} id={view.id} onDone={() => setView({ kind: "list" })} />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Workspaces"
        description="Group chats by project or team. Each workspace has its own folder, rules, and defaults for new chats."
      >
        <Button onClick={() => setView({ kind: "edit" })}>
          <PlusIcon />
          New workspace
        </Button>
      </SectionHeading>

      {workspaces.isPending ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 2 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : workspaces.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Couldn't load your workspaces</AlertTitle>
          <AlertDescription>{workspaces.error.message}</AlertDescription>
        </Alert>
      ) : (
        <ItemGroup>
          {workspaces.data.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              bridge={bridge}
              workspace={workspace}
              onEdit={() => setView({ kind: "edit", id: workspace.id })}
            />
          ))}
        </ItemGroup>
      )}
    </div>
  );
}
