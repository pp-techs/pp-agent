import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import {
  ChevronDownIcon,
  FileTextIcon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { isWebUrl, researchDepthKey, researchPhaseKey, sourceHost } from "@/lib/research";
import { researchReportQuery, useResearchPending, useSetResearch } from "@/lib/queries";
import { useChatStore } from "@/stores/chat-store";
import { useFileTabsStore } from "@/stores/file-tabs-store";
import { usePanelStore } from "@/stores/panel-store";

/**
 * The open conversation's research run above the message box: where it stands, how many pages it
 * read and sources it cites; pause/resume and clear; and, when opened, the cited sources and the
 * report (in the Files panel on the desktop, inline on the phone, which cannot read the workspace).
 */
export function ResearchBanner({ bridge }: { bridge: DesktopBridge }) {
  const run = useChatStore((state) => state.research);
  const root = useChatStore((state) => state.workspaceDir);
  const setResearch = useSetResearch(bridge);
  const pending = useResearchPending();
  const { t } = useTranslation("chat");
  const [open, setOpen] = React.useState(false);
  // The phone loads the report text through the daemon; the desktop opens the saved file.
  const report = useQuery({
    ...researchReportQuery(bridge, run?.report?.markdown ?? ""),
    enabled: open && bridge.kind === "web" && Boolean(run?.report),
  });
  if (!run) return null;

  const paused = run.status === "paused";
  const done = run.status === "done";
  const toggle = paused ? t("research.resume") : t("research.pause");
  const onError = (error: Error) => toast.error(error.message);

  function openReport() {
    const path = run?.report?.markdown;
    if (!path) return;
    if (bridge.kind === "desktop" && root) {
      useFileTabsStore.getState().open(root, path);
      usePanelStore.getState().show("files");
    } else {
      setOpen(true);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-3 pb-2 md:px-6">
      <div className="rounded-2xl border bg-muted/40 text-sm">
        <div role="status" className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate" title={run.question}>
                {run.question}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {t("research.summary", {
                  status: t(researchPhaseKey(run)),
                  depth: t(researchDepthKey(run.depth)),
                  visited: run.visited,
                  sources: run.sources.length,
                })}
              </span>
            </span>
            <ChevronDownIcon
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
          {done && run.report && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("research.openReport")}
                    onClick={openReport}
                  />
                }
              >
                <FileTextIcon />
              </TooltipTrigger>
              <TooltipContent>{t("research.openReport")}</TooltipContent>
            </Tooltip>
          )}
          {!done && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={toggle}
                    disabled={pending}
                    onClick={() =>
                      setResearch.mutate({ action: paused ? "resume" : "pause" }, { onError })
                    }
                  />
                }
              >
                {paused ? <PlayIcon /> : <PauseIcon />}
              </TooltipTrigger>
              <TooltipContent>{toggle}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("research.clear")}
                  disabled={pending}
                  onClick={() => setResearch.mutate({ action: "clear" }, { onError })}
                />
              }
            >
              <XIcon />
            </TooltipTrigger>
            <TooltipContent>{t("research.clear")}</TooltipContent>
          </Tooltip>
        </div>
        {open && (
          <div className="max-h-80 overflow-y-auto border-t px-4 py-3">
            {run.sources.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("research.noSources")}</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {run.sources.map((source) => (
                  <li key={source.n} className="flex min-w-0 items-baseline gap-2 text-xs">
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      [{source.n}]
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" title={source.title}>
                        {source.title}
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <LinkIcon className="size-3 shrink-0" />
                        {isWebUrl(source.url) ? (
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate hover:underline"
                          >
                            {sourceHost(source.url)}
                          </a>
                        ) : (
                          <span className="truncate">{source.url}</span>
                        )}
                        {source.date ? <span>· {source.date}</span> : null}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {bridge.kind === "web" && run.report && (
              <div className="mt-3 border-t pt-3">
                {report.data ? (
                  <div className="text-sm">
                    <Markdown>{report.data.markdown}</Markdown>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("research.loadingReport")}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
