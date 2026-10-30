import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  PaperclipIcon,
  RefreshCwIcon,
  SquareArrowOutUpRightIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { PanelTab, PanelTabs } from "@/components/panel/panel-tabs";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { filePreviewQuery, workspaceFolderQuery } from "@/lib/panel-queries";
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
      <div className="min-h-0 flex-1 overflow-auto">
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
            {isMarkdown ? (
              <div className="px-4 py-2 text-sm">
                <Markdown>{preview.data.text}</Markdown>
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

function FolderRows({
  bridge,
  root,
  dir,
  depth,
  expanded,
  onToggle,
  onOpen,
}: {
  bridge: DesktopBridge;
  root: string;
  dir: string;
  depth: number;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation("chat");
  const entries = useQuery(workspaceFolderQuery(bridge, root, dir));
  const indent = { paddingLeft: `${0.5 + depth * 0.875}rem` };

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
  if (entries.data.length === 0 && depth > 0)
    return (
      <p style={indent} className="py-1 pr-2 text-xs text-muted-foreground">
        {t("panel.files.emptyFolder")}
      </p>
    );
  return entries.data.map((entry) => {
    const isOpen = entry.kind === "folder" && expanded.has(entry.path);
    const Icon = entry.kind === "file" ? FileIcon : isOpen ? FolderOpenIcon : FolderIcon;
    return (
      <React.Fragment key={entry.path}>
        <button
          type="button"
          style={indent}
          className="flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
          title={entry.path}
          aria-expanded={entry.kind === "folder" ? isOpen : undefined}
          onClick={() => (entry.kind === "folder" ? onToggle(entry.path) : onOpen(entry.path))}
        >
          <ChevronRightIcon
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${entry.kind === "file" ? "invisible" : ""} ${isOpen ? "rotate-90" : ""}`}
          />
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{entry.name}</span>
        </button>
        {isOpen && (
          <FolderRows
            bridge={bridge}
            root={root}
            dir={entry.path}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        )}
      </React.Fragment>
    );
  });
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
        <FolderRows
          bridge={bridge}
          root={root}
          dir=""
          depth={0}
          expanded={expanded}
          onToggle={(path) => toggleFolder(root, path)}
          onOpen={(path) => openFile(root, path)}
        />
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
            icon={<FileIcon />}
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
