import * as React from "react";
import { ARTIFACT_FRAME_URL } from "@workspace/shared";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  CodeIcon,
  EyeIcon,
  PanelRightOpenIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { Mounted } from "pele/lazy";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { bridge } from "@/lib/bridge";
import { useChatStore } from "@/stores/chat-store";
import { useFileTabsStore } from "@/stores/file-tabs-store";
import { usePanelStore } from "@/stores/panel-store";

/** HTML previews need the desktop app's sandboxed frame scheme; the web app shows the code. */
const canRunHtml = bridge?.kind === "desktop";

/** Code block languages drawn instead of shown. HTML runs only in the desktop window. */
export function isVisualLanguage(language: string): boolean {
  return language === "mermaid" || language === "svg" || (language === "html" && canRunHtml);
}

/** Height of a chat preview: grows with its content up to this, then scrolls inside. */
const FRAME_HEIGHT = { min: 120, max: 640 } as const;

/**
 * A mermaid diagram drawn by Pele: SVG themed by the `.pele` variables in index.css, re-laid out
 * when its container is resized, with zoom when it has to shrink. Each diagram type loads on first
 * use. Pele escapes the text and never emits scripts, event handlers or HTML labels; links and
 * images are off, since an image would load from anywhere the moment the reply shows it. A diagram
 * it cannot draw shows Pele's error in place (as text).
 */
function MermaidDiagram({ code }: { code: string }) {
  const { t } = useTranslation("chat");
  const container = React.useRef<HTMLDivElement>(null);
  // Only when the diagram type itself fails to load; drawing errors show inside the container.
  const [loadError, setLoadError] = React.useState<{ code: string; message: string } | null>(null);

  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cancelled = false;
    let mounted: Mounted | undefined;
    // Loaded on first use (Pele's core is about 50 KB), then each diagram type on demand.
    import("pele/lazy")
      .then(({ mountAsync }) =>
        mountAsync(element, code, {
          links: false,
          images: false,
          zoom: {
            labels: {
              zoomIn: t("visual.zoomIn"),
              zoomOut: t("visual.zoomOut"),
              reset: t("visual.zoomReset"),
            },
          },
        }),
      )
      .then(
        (result) => {
          if (cancelled) result.destroy();
          else mounted = result;
        },
        (error: unknown) => {
          if (!cancelled)
            setLoadError({ code, message: error instanceof Error ? error.message : String(error) });
        },
      );
    return () => {
      cancelled = true;
      mounted?.destroy();
      element.replaceChildren();
    };
  }, [code, t]);

  if (loadError?.code === code)
    return (
      <p className="p-4 text-xs whitespace-pre-wrap text-destructive">
        {t("visual.mermaidError", { error: loadError.message })}
      </p>
    );
  return <div ref={container} className="relative p-4" />;
}

/** An SVG as an image: browsers run no script and load nothing for an SVG shown this way. */
function SvgImage({ code }: { code: string }) {
  const { t } = useTranslation("chat");
  // The code that failed to load; a new block of code gets a fresh try.
  const [failedCode, setFailedCode] = React.useState<string | null>(null);
  if (failedCode === code)
    return <p className="p-4 text-xs text-destructive">{t("visual.svgError")}</p>;
  return (
    <div className="flex justify-center p-4">
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(code)}`}
        alt={t("visual.svgAlt")}
        className="h-auto max-w-full"
        onError={() => setFailedCode(code)}
      />
    </div>
  );
}

interface FrameMessage {
  type?: unknown;
  height?: unknown;
}

/**
 * An HTML page in a sandboxed iframe of the desktop app's preview scheme: its own origin-less
 * document with no network, no navigation and no bridge (see main/artifact-protocol.ts). It runs
 * only after the person presses Run. `fill` makes it take the whole height of its parent (the Files
 * panel); otherwise it grows with its content within `FRAME_HEIGHT`.
 */
export function HtmlPreview({ html, fill = false }: { html: string; fill?: boolean }) {
  const { t } = useTranslation("chat");
  // Bumped by Run and Restart: a new key loads a fresh frame.
  const [run, setRun] = React.useState(0);
  const [height, setHeight] = React.useState<number>(FRAME_HEIGHT.min);
  const frame = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    if (run === 0) return;
    let sent = false;
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || event.source !== target) return;
      const data = (event.data ?? {}) as FrameMessage;
      if (data.type === "ready" && !sent) {
        sent = true;
        // The frame's origin is opaque, so "*" is the only target that reaches it.
        target.postMessage({ type: "render", html }, "*");
      } else if (data.type === "height" && typeof data.height === "number") {
        const next = Number.isFinite(data.height) ? data.height : FRAME_HEIGHT.min;
        setHeight(Math.min(FRAME_HEIGHT.max, Math.max(FRAME_HEIGHT.min, Math.ceil(next))));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [run, html]);

  if (run === 0)
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 p-6 text-center",
          fill && "h-full",
        )}
      >
        <Button size="sm" onClick={() => setRun(1)}>
          <PlayIcon data-icon="inline-start" />
          {t("visual.run")}
        </Button>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheckIcon className="size-3.5" />
          {t("visual.sandboxNote")}
        </p>
      </div>
    );

  return (
    <div className={cn("relative", fill && "h-full")}>
      <iframe
        key={run}
        ref={frame}
        src={ARTIFACT_FRAME_URL}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={t("visual.htmlTitle")}
        className="block w-full border-0 bg-white"
        style={fill ? { height: "100%" } : { height }}
      />
      <Button
        variant="secondary"
        size="icon-xs"
        className="absolute top-2 right-2 opacity-70 hover:opacity-100"
        aria-label={t("visual.restart")}
        title={t("visual.restart")}
        onClick={() => {
          setHeight(FRAME_HEIGHT.min);
          setRun((value) => value + 1);
        }}
      >
        <RotateCcwIcon />
      </Button>
    </div>
  );
}

/** Saves an HTML preview into the workspace and shows it in the Files panel. */
async function openInPanel(html: string, root: string, savedMessage: (path: string) => string) {
  if (!bridge) return;
  try {
    const path = await bridge.workspace.saveArtifact(root, html);
    useFileTabsStore.getState().open(root, path);
    usePanelStore.getState().show("files");
    toast.success(savedMessage(path));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

function CodeLines({ code, language }: { code: string; language: string }) {
  const lines = useHighlightedCode(code, language);
  return (
    <CodeBlockContent>
      {lines.map((line, index) => (
        <CodeBlockLine key={index}>{line}</CodeBlockLine>
      ))}
    </CodeBlockContent>
  );
}

/** A finished mermaid, svg or html code block in a reply: the drawing, with a switch to its code. */
export function VisualCodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useTranslation("chat");
  const root = useChatStore((state) => state.workspaceDir);
  const [showCode, setShowCode] = React.useState(false);
  const source = code.endsWith("\n") ? code.slice(0, -1) : code;
  const toggleLabel = showCode ? t("visual.showPreview") : t("visual.showCode");

  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>{language}</CodeBlockTitle>
        <CodeBlockActions>
          {language === "html" && root && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("visual.openInPanel")}
                    onClick={() =>
                      void openInPanel(source, root, (path) => t("visual.saved", { path }))
                    }
                  />
                }
              >
                <PanelRightOpenIcon />
              </TooltipTrigger>
              <TooltipContent>{t("visual.openInPanel")}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={toggleLabel}
                  aria-pressed={showCode}
                  onClick={() => setShowCode((value) => !value)}
                />
              }
            >
              {showCode ? <EyeIcon /> : <CodeIcon />}
            </TooltipTrigger>
            <TooltipContent>{toggleLabel}</TooltipContent>
          </Tooltip>
          <CodeBlockCopyButton value={source} />
        </CodeBlockActions>
      </CodeBlockHeader>
      {showCode ? (
        <CodeLines code={source} language={language} />
      ) : (
        <div className="bg-background">
          {language === "mermaid" ? (
            <MermaidDiagram code={source} />
          ) : language === "svg" ? (
            <SvgImage code={source} />
          ) : (
            <HtmlPreview html={source} />
          )}
        </div>
      )}
    </CodeBlock>
  );
}
