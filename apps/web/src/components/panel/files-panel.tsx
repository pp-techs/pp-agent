import * as React from "react";
import type { DesktopBridge, WorkspaceEntry } from "@workspace/shared";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@workspace/ui/components/code-block";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  EyeIcon,
  FileCodeIcon,
  FileIcon,
  FilePlusIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { FileTypeIcon } from "@/components/panel/file-icon";
import { PanelTab, PanelTabs } from "@/components/panel/panel-tabs";
import { HtmlPreview } from "@/components/visual-preview";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import {
  filePreviewQuery,
  useWorkspaceFileCommands,
  workspaceFolderQuery,
} from "@/lib/panel-queries";
import { queryKeys } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";
import { useComposerStore } from "@/stores/composer-store";
import { NO_FILE_TABS, useFileTabsStore } from "@/stores/file-tabs-store";

/** File extensions the highlighter knows by another name. */
const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  zsh: "bash",
  ps1: "powershell",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  kt: "kotlin",
  cs: "csharp",
};

/** Last part of a `/`-separated path (or of an absolute folder). */
function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function languageOf(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGES[extension] ?? extension;
}

function formatSize(bytes: number, language: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

function TextPreview({ path, text }: { path: string; text: string }) {
  const language = languageOf(path);
  const lines = useHighlightedCode(text, language);
  return (
    <CodeBlock className="rounded-none border-0">
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={text} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function FilePreviewView({
  bridge,
  root,
  path,
}: {
  bridge: DesktopBridge;
  root: string;
  path: string;
}) {
  const { t, i18n } = useTranslation("chat");
  const preview = useQuery(filePreviewQuery(bridge, root, path));
  const addAttachments = useComposerStore((state) => state.add);
  const name = fileName(path);
  const isMarkdown = /\.(md|markdown)$/i.test(name);
  const isHtml = /\.html?$/i.test(name);
  // Markdown shows rendered and HTML as a preview (after Run); this switches to their text.
  const [showSource, setShowSource] = React.useState(false);
  // A cut-off page would run broken, so only a whole HTML file previews.
  const canPreview =
    isMarkdown || (isHtml && preview.data?.kind === "text" && !preview.data.truncated);
  const showsHtml = isHtml && canPreview && !showSource;

  async function attach() {
    try {
      addAttachments([await bridge.workspace.attachment(root, path)]);
      toast.success(t("panel.files.attached", { name }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pb-1">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={path}>
          {path}
        </span>
        {canPreview && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    showSource ? t("panel.files.showPreview") : t("panel.files.showSource")
                  }
                  aria-pressed={showSource}
                  onClick={() => setShowSource((value) => !value)}
                />
              }
            >
              {showSource ? <EyeIcon /> : <FileCodeIcon />}
            </TooltipTrigger>
            <TooltipContent>
              {showSource ? t("panel.files.showPreview") : t("panel.files.showSource")}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("panel.files.attach")}
                onClick={() => void attach()}
              />
            }
          >
            <PaperclipIcon />
          </TooltipTrigger>
          <TooltipContent>{t("panel.files.attach")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("panel.files.reveal")}
                onClick={() =>
                  bridge.workspace
                    .reveal(root, path)
                    .catch((error: Error) => toast.error(error.message))
                }
              />
            }
          >
            <SquareArrowOutUpRightIcon />
          </TooltipTrigger>
          <TooltipContent>{t("panel.files.reveal")}</TooltipContent>
        </Tooltip>
      </div>
      <div className={cn("min-h-0 flex-1", showsHtml ? "flex flex-col" : "overflow-auto")}>
        {preview.isPending ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : preview.isError ? (
          <Alert variant="destructive" className="m-3 w-auto">
            <TriangleAlertIcon />
            <AlertDescription>{preview.error.message}</AlertDescription>
          </Alert>
        ) : preview.data.kind === "image" ? (
          <div className="flex justify-center p-3">
            <img
              src={preview.data.dataUrl}
              alt={name}
              className="max-w-full rounded-lg object-contain"
            />
          </div>
        ) : preview.data.kind === "text" ? (
          <>
            {isMarkdown && !showSource ? (
              <div className="px-4 py-2 text-sm">
                <Markdown>{preview.data.text}</Markdown>
              </div>
            ) : showsHtml ? (
              <div className="min-h-0 flex-1">
                <HtmlPreview key={preview.data.text} html={preview.data.text} fill />
              </div>
            ) : (
              <TextPreview path={path} text={preview.data.text} />
            )}
            {preview.data.truncated && (
              <p className="px-4 py-2 text-xs text-muted-foreground">
                {t("panel.files.truncated", { size: formatSize(preview.data.size, i18n.language) })}
              </p>
            )}
          </>
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileIcon />
              </EmptyMedia>
              <EmptyTitle>{t("panel.files.noPreviewTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("panel.files.noPreview", { size: formatSize(preview.data.size, i18n.language) })}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}

/** What the tree is asking a name for: a new file or folder in `dir`, or a new name for `path`. */
type Editing =
  | { kind: "new"; entry: "file" | "folder"; dir: string }
  | { kind: "rename"; path: string };

/** What a row of the tree does; keeps its identity, so rows re-render only when they change. */
interface RowActions {
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onStartCreate: (dir: string, entry: "file" | "folder") => void;
  onStartRename: (path: string) => void;
  onRemove: (path: string) => void;
  onReveal: (path: string) => void;
}

/** What the levels of the tree share. */
interface TreeOps {
  expanded: ReadonlySet<string>;
  editing: Editing | null;
  row: RowActions;
  onSubmitName: (name: string) => void;
  onCancelEdit: () => void;
}

/** A row that asks for a name: Enter confirms, Escape or leaving the field cancels. */
function NameInput({
  initial,
  icon,
  indent,
  onSubmit,
  onCancel,
}: {
  initial: string;
  icon: React.ReactNode;
  indent: React.CSSProperties;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("chat");
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.focus();
    // Select the name without its extension, as editors do.
    const dot = initial.lastIndexOf(".");
    field.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  return (
    <div style={indent} className="flex h-7 items-center gap-1.5 pr-2">
      <span className="size-3.5 shrink-0" />
      <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <input
        ref={input}
        defaultValue={initial}
        aria-label={t("panel.files.name")}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="h-6 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1.5 text-sm outline-none"
        onKeyDown={(event) => {
          // Keys typed in the name must not reach the shortcuts of the row or panel.
          event.stopPropagation();
          if (event.key === "Enter") onSubmit(event.currentTarget.value);
          else if (event.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
      />
    </div>
  );
}

/** One file or folder of the tree; right click opens its menu. */
const EntryRow = React.memo(function EntryRow({
  entry,
  actions,
  indent,
  isOpen,
}: {
  entry: WorkspaceEntry;
  actions: RowActions;
  indent: React.CSSProperties;
  isOpen: boolean;
}) {
  const { t } = useTranslation("chat");
  // Where the right click happened; the menu is open while it is set.
  const [point, setPoint] = React.useState<{ x: number; y: number } | null>(null);
  // The menu mounts on the first right click, not for each of up to thousands of rows, and then
  // stays so it can animate closed.
  const [menuMounted, setMenuMounted] = React.useState(false);
  const anchor = React.useMemo(
    () =>
      point
        ? { getBoundingClientRect: () => DOMRect.fromRect({ x: point.x, y: point.y }) }
        : undefined,
    [point],
  );
  return (
    <div
      className="relative"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuMounted(true);
        setPoint({ x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        style={indent}
        className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted data-[menu-open]:bg-muted"
        data-menu-open={point !== null || undefined}
        title={entry.path}
        aria-expanded={entry.kind === "folder" ? isOpen : undefined}
        onClick={() =>
          entry.kind === "folder" ? actions.onToggle(entry.path) : actions.onOpen(entry.path)
        }
        onKeyDown={(event) => {
          if (event.key === "F2") actions.onStartRename(entry.path);
          else if (event.key === "Delete") actions.onRemove(entry.path);
          else return;
          event.preventDefault();
        }}
      >
        <ChevronRightIcon
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${entry.kind === "file" ? "invisible" : ""} ${isOpen ? "rotate-90" : ""}`}
        />
        <FileTypeIcon kind={entry.kind} name={entry.name} open={isOpen} />
        <span className="truncate">{entry.name}</span>
      </button>
      {menuMounted && (
        <DropdownMenu open={point !== null} onOpenChange={(open) => !open && setPoint(null)}>
          {/* The name field takes the focus; the menu must not take it back when it closes. */}
          <DropdownMenuContent
            align="start"
            sideOffset={0}
            anchor={anchor}
            className="w-48"
            finalFocus={false}
          >
            {entry.kind === "folder" && (
              <>
                <DropdownMenuItem onClick={() => actions.onStartCreate(entry.path, "file")}>
                  <FilePlusIcon />
                  {t("panel.files.newFile")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onStartCreate(entry.path, "folder")}>
                  <FolderPlusIcon />
                  {t("panel.files.newFolder")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => actions.onStartRename(entry.path)}>
              <PencilIcon />
              {t("panel.files.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onReveal(entry.path)}>
              <SquareArrowOutUpRightIcon />
              {t("panel.files.reveal")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => actions.onRemove(entry.path)}>
              <Trash2Icon />
              {t("panel.files.moveToTrash")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
});

function FolderRows({
  bridge,
  root,
  dir,
  depth,
  tree,
}: {
  bridge: DesktopBridge;
  root: string;
  dir: string;
  depth: number;
  tree: TreeOps;
}) {
  const { t } = useTranslation("chat");
  const entries = useQuery(workspaceFolderQuery(bridge, root, dir));
  const indent = React.useMemo(() => ({ paddingLeft: `${0.5 + depth * 0.875}rem` }), [depth]);
  const { editing } = tree;
  const creating = editing?.kind === "new" && editing.dir === dir ? editing : null;

  if (entries.isPending)
    return (
      <div style={indent} className="py-1 pr-2">
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  if (entries.isError)
    return (
      <p style={indent} className="py-1 pr-2 text-xs text-destructive">
        {entries.error.message}
      </p>
    );
  return (
    <>
      {creating && (
        <NameInput
          initial=""
          icon={<FileTypeIcon kind={creating.entry} name="" />}
          indent={indent}
          onSubmit={tree.onSubmitName}
          onCancel={tree.onCancelEdit}
        />
      )}
      {entries.data.length === 0 && depth > 0 && !creating && (
        <p style={indent} className="py-1 pr-2 text-xs text-muted-foreground">
          {t("panel.files.emptyFolder")}
        </p>
      )}
      {entries.data.map((entry) => {
        const isOpen = entry.kind === "folder" && tree.expanded.has(entry.path);
        if (editing?.kind === "rename" && editing.path === entry.path)
          return (
            <NameInput
              key={entry.path}
              initial={entry.name}
              icon={<FileTypeIcon kind={entry.kind} name={entry.name} open={isOpen} />}
              indent={indent}
              onSubmit={tree.onSubmitName}
              onCancel={tree.onCancelEdit}
            />
          );
        return (
          <React.Fragment key={entry.path}>
            <EntryRow entry={entry} actions={tree.row} indent={indent} isOpen={isOpen} />
            {isOpen && (
              <FolderRows
                bridge={bridge}
                root={root}
                dir={entry.path}
                depth={depth + 1}
                tree={tree}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

/** The folder tree of a workspace, with its toolbar. */
function FolderTree({ bridge, root }: { bridge: DesktopBridge; root: string }) {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const expandedList = useFileTabsStore(
    (state) => state.byRoot[root]?.expanded ?? NO_FILE_TABS.expanded,
  );
  const expanded = React.useMemo(() => new Set(expandedList), [expandedList]);
  const toggleFolder = useFileTabsStore((state) => state.toggleFolder);
  const openFile = useFileTabsStore((state) => state.open);
  const commands = useWorkspaceFileCommands(bridge, root);
  const [editing, setEditing] = React.useState<Editing | null>(null);

  const { mutate: removeEntry } = commands.remove;
  const row = React.useMemo<RowActions>(
    () => ({
      onToggle: (path) => toggleFolder(root, path),
      onOpen: (path) => openFile(root, path),
      onStartCreate: (dir, entry) => {
        // The new row appears inside the folder, so it has to be open.
        const open = useFileTabsStore.getState().byRoot[root]?.expanded.includes(dir) ?? false;
        if (dir !== "" && !open) toggleFolder(root, dir);
        setEditing({ kind: "new", entry, dir });
      },
      onStartRename: (path) => setEditing({ kind: "rename", path }),
      onRemove: (path) => removeEntry(path),
      onReveal: (path) =>
        bridge.workspace.reveal(root, path).catch((error: Error) => toast.error(error.message)),
    }),
    [bridge, root, toggleFolder, openFile, removeEntry],
  );

  const tree: TreeOps = {
    expanded,
    editing,
    row,
    onCancelEdit: () => setEditing(null),
    onSubmitName: (name) => {
      const trimmed = name.trim();
      if (!editing || commands.create.isPending || commands.rename.isPending) return;
      if (!trimmed || (editing.kind === "rename" && trimmed === fileName(editing.path)))
        return setEditing(null);
      const done = { onSuccess: () => setEditing(null) };
      if (editing.kind === "new")
        commands.create.mutate({ dir: editing.dir, name: trimmed, kind: editing.entry }, done);
      else commands.rename.mutate({ path: editing.path, name: trimmed }, done);
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pb-1">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={root}>
          {root}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("panel.files.newFile")}
                onClick={() => row.onStartCreate("", "file")}
              />
            }
          >
            <FilePlusIcon />
          </TooltipTrigger>
          <TooltipContent>{t("panel.files.newFile")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("panel.files.newFolder")}
                onClick={() => row.onStartCreate("", "folder")}
              />
            }
          >
            <FolderPlusIcon />
          </TooltipTrigger>
          <TooltipContent>{t("panel.files.newFolder")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("panel.files.refresh")}
                onClick={() =>
                  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceFiles(root) })
                }
              />
            }
          >
            <RefreshCwIcon />
          </TooltipTrigger>
          <TooltipContent>{t("panel.files.refresh")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("panel.files.openFolder")}
                onClick={() =>
                  bridge.files
                    .openWorkspace(root)
                    .catch((error: Error) => toast.error(error.message))
                }
              />
            }
          >
            <FolderOpenIcon />
          </TooltipTrigger>
          <TooltipContent>{t("panel.files.openFolder")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        <FolderRows bridge={bridge} root={root} dir="" depth={0} tree={tree} />
      </div>
    </div>
  );
}

/** One workspace: the folder tree as the first tab, then a tab per opened file. */
function WorkspaceFiles({ bridge, root }: { bridge: DesktopBridge; root: string }) {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const tabs = useFileTabsStore((state) => state.byRoot[root] ?? NO_FILE_TABS);
  const activate = useFileTabsStore((state) => state.activate);
  const close = useFileTabsStore((state) => state.close);

  React.useEffect(() => {
    const refresh = (changed: string) => {
      if (changed !== root) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceFiles(changed) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.filePreviews(changed) });
    };
    const unsubscribe = bridge.workspace.onChanged(refresh);
    bridge.workspace.watch(root).catch((error: Error) => toast.error(error.message));
    return () => {
      unsubscribe();
      void bridge.workspace.watch(null);
    };
  }, [bridge, root, queryClient]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelTabs>
        <PanelTab
          active={tabs.active === null}
          icon={<FolderTreeIcon />}
          label={fileName(root)}
          title={root}
          onSelect={() => activate(root, null)}
        />
        {tabs.open.map((path) => (
          <PanelTab
            key={path}
            active={tabs.active === path}
            icon={<FileTypeIcon kind="file" name={fileName(path)} />}
            label={fileName(path)}
            title={path}
            closeLabel={t("panel.files.closeTab", { name: fileName(path) })}
            onSelect={() => activate(root, path)}
            onClose={() => close(root, path)}
          />
        ))}
      </PanelTabs>
      {tabs.active === null ? (
        <FolderTree bridge={bridge} root={root} />
      ) : (
        <FilePreviewView key={tabs.active} bridge={bridge} root={root} path={tabs.active} />
      )}
    </div>
  );
}

/** The open conversation's workspace; each workspace keeps its own tabs. */
export function FilesPanel({ bridge }: { bridge: DesktopBridge }) {
  const root = useChatStore((state) => state.workspaceDir);
  return root ? <WorkspaceFiles key={root} bridge={bridge} root={root} /> : null;
}
