import type { FilePreview } from "@workspace/shared";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
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
import { cn } from "@workspace/ui/lib/utils";
import { FileIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Markdown } from "@/components/markdown";
import { HtmlPreview } from "@/components/visual-preview";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

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
export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function languageOf(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGES[extension] ?? extension;
}

export function formatSize(bytes: number, language: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

export function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown)$/i.test(fileName(path));
}

export function isHtmlFile(path: string): boolean {
  return /\.html?$/i.test(fileName(path));
}

/**
 * Whether the file has a richer form than its text: Markdown rendered, or an HTML page run (only
 * whole files, as a cut-off page would run broken).
 */
export function canPreviewFile(path: string, preview: FilePreview | undefined): boolean {
  if (isMarkdownFile(path)) return true;
  return isHtmlFile(path) && preview?.kind === "text" && !preview.truncated;
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

/**
 * A file's content as the app shows it: Markdown rendered (mermaid drawn), code highlighted, an
 * image, or the reason there is nothing to show. Shared by the desktop side panel and the files
 * page of the app on a phone, so both show a file the same way.
 */
export function FileContent({
  path,
  preview,
  error,
  showSource,
  allowHtml,
  className,
}: {
  path: string;
  /** Undefined while it loads. */
  preview: FilePreview | undefined;
  error?: Error | null;
  /** Markdown and HTML show their text instead of their rendered form. */
  showSource: boolean;
  /** Whether an HTML page may run here (the desktop window's sandboxed frame). */
  allowHtml: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation("chat");
  const name = fileName(path);
  if (error) {
    return (
      <Alert variant="destructive" className="m-3 w-auto">
        <TriangleAlertIcon />
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }
  if (!preview) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (preview.kind === "image") {
    return (
      <div className="flex justify-center p-3">
        <img src={preview.dataUrl} alt={name} className="max-w-full rounded-lg object-contain" />
      </div>
    );
  }
  if (preview.kind === "none") {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileIcon />
          </EmptyMedia>
          <EmptyTitle>{t("panel.files.noPreviewTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("panel.files.noPreview", { size: formatSize(preview.size, i18n.language) })}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const showsHtml = allowHtml && isHtmlFile(path) && !preview.truncated && !showSource;
  return (
    // An HTML page fills the space it is given, so the root is the flex column that passes it down.
    <div className={cn(showsHtml && "flex min-h-0 flex-1 flex-col", className)}>
      {isMarkdownFile(path) && !showSource ? (
        <div className="px-4 py-2 text-sm">
          <Markdown>{preview.text}</Markdown>
        </div>
      ) : showsHtml ? (
        <HtmlPreview key={preview.text} html={preview.text} fill />
      ) : (
        <TextPreview path={path} text={preview.text} />
      )}
      {preview.truncated && (
        <p className="px-4 py-2 text-xs text-muted-foreground">
          {t("panel.files.truncated", { size: formatSize(preview.size, i18n.language) })}
        </p>
      )}
    </div>
  );
}
