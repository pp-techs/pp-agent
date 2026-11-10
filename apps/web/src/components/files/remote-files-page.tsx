import * as React from "react";
import type { DesktopBridge, WorkspaceEntry, WorkspaceSummary } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  FileCodeIcon,
  FolderIcon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { canPreviewFile, FileContent, fileName, formatSize } from "@/components/files/file-content";
import { FileTypeIcon } from "@/components/panel/file-icon";
import { remoteFileQuery, remoteFolderQuery } from "@/lib/remote-files";
import { useChatStore } from "@/stores/chat-store";

/** A file opened from the list: its name, path and the details the list showed. */
interface Opened {
  path: string;
  size: number;
  modified: number;
}

function dateOf(modified: number, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(modified),
  );
}

/** The file, its toolbar and the text tools; keyed by path, so each file starts rendered. */
function SheetBody({
  bridge,
  workspaceId,
  file,
  onClose,
}: {
  bridge: DesktopBridge;
  workspaceId: string;
  file: Opened;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("chat");
  const [showSource, setShowSource] = React.useState(false);
  const preview = useQuery(remoteFileQuery(bridge, workspaceId, file.path));
  const canPreview = canPreviewFile(file.path, preview.data);

  async function copy() {
    if (preview.data?.kind !== "text") return;
    try {
      await navigator.clipboard.writeText(preview.data.text);
      toast.success(t("files.copied"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <DialogHeader className="flex shrink-0 flex-row items-center gap-1.5 border-b border-border/50 px-2 py-2">
        <FileTypeIcon kind="file" name={file.path} />
        <div className="min-w-0 flex-1">
          <DialogTitle className="truncate text-sm">{fileName(file.path)}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {file.path} · {formatSize(file.size, i18n.language)}
          </DialogDescription>
        </div>
        {canPreview && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={showSource ? t("panel.files.showPreview") : t("panel.files.showSource")}
            aria-pressed={showSource}
            onClick={() => setShowSource((value) => !value)}
          >
            {showSource ? <EyeIcon /> : <FileCodeIcon />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("panel.files.refresh")}
          disabled={preview.isFetching}
          onClick={() => void preview.refetch()}
        >
          <RefreshCwIcon className={preview.isFetching ? "animate-spin" : undefined} />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t("files.close")} onClick={onClose}>
          <XIcon />
        </Button>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <FileContent
          path={file.path}
          preview={preview.data}
          error={preview.error}
          showSource={showSource}
          allowHtml
          className="min-h-0"
        />
      </div>
      {preview.data?.kind === "text" && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">
          <span className="truncate">{dateOf(file.modified, i18n.language)}</span>
          <Button variant="ghost" size="sm" onClick={() => void copy()}>
            {t("files.copy")}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * A file of the workspace, whole screen over the list. It shows its rendered form (Markdown
 * drawn, code highlighted, an HTML page after Run) with a switch to its text for Markdown.
 */
function FileSheet({
  bridge,
  workspaceId,
  file,
  onClose,
}: {
  bridge: DesktopBridge;
  workspaceId: string;
  file: Opened | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-svh max-w-none flex-col gap-0 rounded-none p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:h-[90svh] sm:max-w-2xl sm:rounded-2xl sm:pt-0 sm:pb-0"
      >
        {file && (
          <SheetBody
            key={file.path}
            bridge={bridge}
            workspaceId={workspaceId}
            file={file}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  entry,
  onOpen,
}: {
  entry: WorkspaceEntry;
  onOpen: (entry: WorkspaceEntry) => void;
}) {
  const { i18n } = useTranslation();
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left hover:bg-muted active:bg-muted"
      onClick={() => onOpen(entry)}
    >
      {entry.kind === "folder" ? (
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <FileTypeIcon kind="file" name={entry.name} />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
      {entry.kind === "file" && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatSize(entry.size, i18n.language)}
        </span>
      )}
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/**
 * The open conversation's workspace files, browsed from the app on a phone: folders open in
 * place, a file opens over the page, and the back arrow above the list returns to the chat. The
 * files are read on the computer over the remote connection; the desktop window browses them in
 * the side panel instead.
 */
export function RemoteFilesPage({ bridge, onBack }: { bridge: DesktopBridge; onBack: () => void }) {
  const workspace = useChatStore((state) => state.workspace);
  if (!workspace) return null;
  // Another workspace has other files: its own top folder and no open file.
  return (
    <WorkspaceFiles key={workspace.id} bridge={bridge} workspace={workspace} onBack={onBack} />
  );
}

function WorkspaceFiles({
  bridge,
  workspace,
  onBack,
}: {
  bridge: DesktopBridge;
  workspace: WorkspaceSummary;
  onBack: () => void;
}) {
  const { t } = useTranslation("chat");
  const [dir, setDir] = React.useState("");
  const [open, setOpen] = React.useState<Opened | null>(null);
  const [filter, setFilter] = React.useState("");
  const folder = useQuery(remoteFolderQuery(bridge, workspace.id, dir));
  const segments = dir === "" ? [] : dir.split("/");

  const entries = React.useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return folder.data ?? [];
    return (folder.data ?? []).filter((entry) => entry.name.toLowerCase().includes(term));
  }, [folder.data, filter]);

  function go(next: string) {
    setDir(next);
    setFilter("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 px-2.5">
        {/* Back to the chat; a folder is left by tapping the breadcrumb above it. */}
        <Button variant="ghost" size="icon-sm" aria-label={t("files.back")} onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        {/* The breadcrumb is the way back up, and skips to any folder above. */}
        <nav aria-label={t("files.path")} className="flex min-w-0 flex-1 items-center gap-0.5">
          <button
            type="button"
            className="shrink-0 rounded px-1 py-0.5 text-sm hover:bg-muted"
            onClick={() => go("")}
          >
            {workspace.name}
          </button>
          {segments.map((segment, index) => {
            const path = segments.slice(0, index + 1).join("/");
            const last = index === segments.length - 1;
            return (
              <React.Fragment key={path}>
                <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  aria-current={last ? "page" : undefined}
                  className="min-w-0 truncate rounded px-1 py-0.5 text-sm hover:bg-muted aria-[current=page]:font-medium"
                  onClick={() => !last && go(path)}
                >
                  {segment}
                </button>
              </React.Fragment>
            );
          })}
        </nav>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("panel.files.refresh")}
          disabled={folder.isFetching}
          onClick={() => void folder.refetch()}
        >
          <RefreshCwIcon className={folder.isFetching ? "animate-spin" : undefined} />
        </Button>
      </header>
      {(folder.data?.length ?? 0) > 6 && (
        <div className="relative shrink-0 px-2.5 pb-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("files.filter")}
            aria-label={t("files.filter")}
            className="h-8 pl-7 text-xs"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {folder.isPending ? (
          <div className="flex flex-col gap-1 p-1">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : folder.isError ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderIcon />
              </EmptyMedia>
              <EmptyDescription>{folder.error.message}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : entries.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderIcon />
              </EmptyMedia>
              <EmptyTitle>{filter ? t("files.noMatch") : t("panel.files.emptyFolder")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          entries.map((entry) => (
            <Row
              key={entry.path}
              entry={entry}
              onOpen={(opened) =>
                opened.kind === "folder"
                  ? go(opened.path)
                  : setOpen({ path: opened.path, size: opened.size, modified: opened.modified })
              }
            />
          ))
        )}
      </div>
      <FileSheet
        bridge={bridge}
        workspaceId={workspace.id}
        file={open}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
