import * as React from "react";
import type { DesktopBridge, WorkspaceEntry } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AppWindowIcon,
  ChevronRightIcon,
  EyeIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  FilePlusIcon,
  FolderPlusIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { canPreviewFile, FileContent, fileName, isHtmlFile } from "@/components/files/file-content";
import { FileTypeIcon } from "@/components/panel/file-icon";
import {
  filePreviewQuery,
  useWorkspaceFileCommands,
  workspaceFolderQuery,
  workspaceOpenersQuery,
  workspaceSearchQuery,
} from "@/lib/panel-queries";
import { queryKeys } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";
import { useComposerStore } from "@/stores/composer-store";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useWorkspaceWatch } from "@/hooks/use-panel-state";
import { isWebApp } from "@/lib/bridge";
import { openFile } from "@/lib/workbench-actions";
import { NO_FOLDERS, useFileTreeStore } from "@/stores/file-tree-store";

/**
 * "Open" with the system's app for the file, and "Open with" the apps chosen before or one chosen
 * now. For the content of a menu; the apps are read when the menu opens.
 */
function OpenWithItems({
  bridge,
  root,
  path,
}: {
  bridge: DesktopBridge;
  root: string;
  path: string;
}) {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const openers = useQuery(workspaceOpenersQuery(bridge));
  const report = (error: Error) => toast.error(error.message);
  async function chooseAndOpen() {
    const app = await bridge.workspace.chooseOpener();
    if (!app) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.openerApps });
    await bridge.workspace.openWith(root, path, app.path);
  }
  return (
    <>
      <DropdownMenuItem onClick={() => bridge.workspace.open(root, path).catch(report)}>
        <ExternalLinkIcon />
        {t("panel.files.open")}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <AppWindowIcon />
          {t("panel.files.openWith")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {openers.data?.map((app) => (
            <DropdownMenuItem
              key={app.path}
              title={app.path}
              onClick={() => bridge.workspace.openWith(root, path, app.path).catch(report)}
            >
              {app.name}
            </DropdownMenuItem>
          ))}
          {openers.data && openers.data.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => chooseAndOpen().catch(report)}>
            {t("panel.files.chooseApp")}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

export function FilePreviewView({
  bridge,
  root,
  path,
}: {
  bridge: DesktopBridge;
  root: string;
  path: string;
}) {
  const { t } = useTranslation("chat");
  const preview = useQuery(filePreviewQuery(bridge, root, path));
  const addAttachments = useComposerStore((state) => state.add);
  const name = fileName(path);
  // Markdown shows rendered and HTML as a preview (after Run); this switches to their text.
  const [showSource, setShowSource] = React.useState(false);
  const canPreview = canPreviewFile(path, preview.data);
  const showsHtml = isHtmlFile(path) && canPreview && !showSource;

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
        {!isWebApp && (
          <>
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
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("panel.files.open")}
                    title={t("panel.files.open")}
                  />
                }
              >
                <ExternalLinkIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <OpenWithItems bridge={bridge} root={root} path={path} />
              </DropdownMenuContent>
            </DropdownMenu>
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
          </>
        )}
      </div>
      <div className={cn("min-h-0 flex-1", showsHtml ? "flex flex-col" : "overflow-auto")}>
        <FileContent
          path={path}
          preview={preview.data}
          error={preview.error}
          showSource={showSource}
          allowHtml
        />
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
  bridge: DesktopBridge;
  root: string;
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

/**
 * A menu opened at the point of a right click. It mounts on the first right click, not for each of
 * up to thousands of rows, and then stays so it can animate closed.
 */
function usePointMenu() {
  // Where the right click happened; the menu is open while it is set.
  const [point, setPoint] = React.useState<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const anchor = React.useMemo(
    () =>
      point
        ? { getBoundingClientRect: () => DOMRect.fromRect({ x: point.x, y: point.y }) }
        : undefined,
    [point],
  );
  const open = React.useCallback((x: number, y: number) => {
    setMounted(true);
    setPoint({ x, y });
  }, []);
  const close = React.useCallback(() => setPoint(null), []);
  return { point, mounted, anchor, open, close };
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
  const menu = usePointMenu();
  return (
    <div
      className="relative"
      onContextMenu={(event) => {
        // The panel's own menu is for what no row claims.
        event.stopPropagation();
        if (!isWebApp) event.preventDefault();
        // The computer's files can only be changed on the computer.
        if (isWebApp) return;
        menu.open(event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        style={indent}
        className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted data-[menu-open]:bg-muted"
        data-menu-open={menu.point !== null || undefined}
        title={entry.path}
        aria-expanded={entry.kind === "folder" ? isOpen : undefined}
        onClick={() =>
          entry.kind === "folder" ? actions.onToggle(entry.path) : actions.onOpen(entry.path)
        }
        onKeyDown={(event) => {
          if (isWebApp) return;
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
      {menu.mounted && (
        <DropdownMenu open={menu.point !== null} onOpenChange={(open) => !open && menu.close()}>
          {/* The name field takes the focus; the menu must not take it back when it closes. */}
          <DropdownMenuContent
            align="start"
            sideOffset={0}
            anchor={menu.anchor}
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
            {entry.kind === "file" && (
              <>
                <OpenWithItems bridge={actions.bridge} root={actions.root} path={entry.path} />
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

/** The files whose path holds the words typed in the search field, nearest to the top first. */
function SearchResults({
  bridge,
  root,
  query,
}: {
  bridge: DesktopBridge;
  root: string;
  query: string;
}) {
  const { t } = useTranslation("chat");
  // The last results stay while the next ones load, so the list does not flash between keystrokes.
  const results = useQuery({
    ...workspaceSearchQuery(bridge, root, query),
    enabled: query !== "",
    placeholderData: keepPreviousData,
  });
  if (results.isError)
    return <p className="px-2 py-1 text-xs text-destructive">{results.error.message}</p>;
  if (!results.data)
    return (
      <div className="px-2 py-1">
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  if (results.data.length === 0)
    return <p className="px-2 py-1 text-xs text-muted-foreground">{t("panel.files.noMatch")}</p>;
  return results.data.map((entry) => {
    const dir = entry.path.slice(0, Math.max(entry.path.length - entry.name.length - 1, 0));
    return (
      <button
        key={entry.path}
        type="button"
        title={entry.path}
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
        onClick={() => openFile(root, entry.path)}
      >
        <FileTypeIcon kind="file" name={entry.name} />
        <span className="shrink-0">{entry.name}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{dir}</span>
      </button>
    );
  });
}

/** The folder tree of a workspace, with its search field. */
function FolderTree({ bridge, root }: { bridge: DesktopBridge; root: string }) {
  const { t } = useTranslation("chat");
  const menu = usePointMenu();
  const queryClient = useQueryClient();
  const expandedList = useFileTreeStore((state) => state.expanded[root] ?? NO_FOLDERS);
  const expanded = React.useMemo(() => new Set(expandedList), [expandedList]);
  const toggleFolder = useFileTreeStore((state) => state.toggleFolder);
  const commands = useWorkspaceFileCommands(bridge, root);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [search, setSearch] = React.useState("");

  const { mutate: removeEntry } = commands.remove;
  const row = React.useMemo<RowActions>(
    () => ({
      bridge,
      root,
      onToggle: (path) => toggleFolder(root, path),
      onOpen: (path) => openFile(root, path),
      onStartCreate: (dir, entry) => {
        // The new row appears inside the folder, so it has to be open.
        const open = useFileTreeStore.getState().expanded[root]?.includes(dir) ?? false;
        if (dir !== "" && !open) toggleFolder(root, dir);
        // The name field is a row of the tree, so a search in its place gives way to the tree.
        setSearch("");
        setEditing({ kind: "new", entry, dir });
      },
      onStartRename: (path) => setEditing({ kind: "rename", path }),
      onRemove: (path) => removeEntry(path),
      onReveal: (path) =>
        bridge.workspace.reveal(root, path).catch((error: Error) => toast.error(error.message)),
    }),
    [bridge, root, toggleFolder, removeEntry],
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

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceFiles(root) });
  // The tree shows at once when the field is emptied; a search waits for a pause in the typing.
  const query = useDebouncedValue(search.trim(), 200);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onContextMenu={(event) => {
        // Rows stop their own right click; this is what is left: the toolbar and the empty space.
        event.preventDefault();
        menu.open(event.clientX, event.clientY);
      }}
    >
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            placeholder={t("panel.files.search")}
            aria-label={t("panel.files.search")}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search) {
                event.stopPropagation();
                setSearch("");
              }
            }}
            // The field keeps the system's own menu (paste, select all).
            onContextMenu={(event) => event.stopPropagation()}
          />
          {search && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={t("panel.files.clearSearch")}
                onClick={() => setSearch("")}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("panel.files.refresh")}
                onClick={refresh}
              />
            }
          >
            <RefreshCwIcon />
          </TooltipTrigger>
          <TooltipContent>{t("panel.files.refresh")}</TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {search.trim() ? (
          <SearchResults bridge={bridge} root={root} query={query} />
        ) : (
          <FolderRows bridge={bridge} root={root} dir="" depth={0} tree={tree} />
        )}
      </div>
      {menu.mounted && (
        <DropdownMenu open={menu.point !== null} onOpenChange={(open) => !open && menu.close()}>
          {/* The name field takes the focus; the menu must not take it back when it closes. */}
          <DropdownMenuContent
            align="start"
            sideOffset={0}
            anchor={menu.anchor}
            className="w-48"
            finalFocus={false}
          >
            {/* The computer's files can only be changed on the computer. */}
            {!isWebApp && (
              <>
                <DropdownMenuItem onClick={() => row.onStartCreate("", "file")}>
                  <FilePlusIcon />
                  {t("panel.files.newFile")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => row.onStartCreate("", "folder")}>
                  <FolderPlusIcon />
                  {t("panel.files.newFolder")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => row.onReveal("")}>
                  <SquareArrowOutUpRightIcon />
                  {t("panel.files.reveal")}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={refresh}>
              <RefreshCwIcon />
              {t("panel.files.refresh")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** The open conversation's workspace folder tree; a file opens as a tab of the main area. */
export function FilesPanel({ bridge }: { bridge: DesktopBridge }) {
  const root = useChatStore((state) => state.workspaceDir);
  return root ? <WorkspaceTree key={root} bridge={bridge} root={root} /> : null;
}

function WorkspaceTree({ bridge, root }: { bridge: DesktopBridge; root: string }) {
  useWorkspaceWatch(bridge, root);
  return <FolderTree bridge={bridge} root={root} />;
}
