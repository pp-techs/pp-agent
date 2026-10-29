import * as React from "react";
import type { DesktopBridge, TerminalInfo } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { PlusIcon, SquareTerminalIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { NewTabButton, PanelTab, PanelTabs } from "@/components/panel/panel-tabs";
import { useIsDark } from "@/hooks/use-is-dark";
import { useChatStore } from "@/stores/chat-store";

const LIGHT: ITheme = {
  background: "#ffffff",
  foreground: "#1f2328",
  cursor: "#1f2328",
  selectionBackground: "#0969da33",
};
const DARK: ITheme = {
  background: "#0a0a0a",
  foreground: "#e6edf3",
  cursor: "#e6edf3",
  selectionBackground: "#388bfd55",
};

/** One terminal drawn with xterm.js; its shell runs in the main process. */
function XtermView({ bridge, terminal }: { bridge: DesktopBridge; terminal: TerminalInfo }) {
  const container = React.useRef<HTMLDivElement>(null);
  const xterm = React.useRef<Terminal | null>(null);
  const dark = useIsDark();
  const { id } = terminal;

  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: '"Geist Mono Variable", ui-monospace, Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: document.documentElement.classList.contains("dark") ? DARK : LIGHT,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    xterm.current = term;

    // Listen first, then read the backlog: chunks that arrive meanwhile are kept and those the
    // backlog already holds are skipped by their sequence number.
    let shown = -1;
    const early: Array<{ data: string; seq: number }> = [];
    const unsubscribe = bridge.terminal.onData((terminalId, data, seq) => {
      if (terminalId !== id) return;
      if (shown < 0) early.push({ data, seq });
      else if (seq > shown) {
        shown = seq;
        term.write(data);
      }
    });
    let disposed = false;
    bridge.terminal
      .backlog(id)
      .then((backlog) => {
        if (disposed) return;
        term.write(backlog.output);
        shown = backlog.seq;
        for (const chunk of early) {
          if (chunk.seq > shown) {
            shown = chunk.seq;
            term.write(chunk.data);
          }
        }
      })
      .catch((error: Error) => toast.error(error.message));
    const input = term.onData((data) => bridge.terminal.write(id, data));

    const resize = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      fit.fit();
      bridge.terminal.resize(id, { cols: term.cols, rows: term.rows });
    };
    const observer = new ResizeObserver(() => requestAnimationFrame(resize));
    observer.observe(element);
    resize();
    term.focus();

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      unsubscribe();
      term.dispose();
      xterm.current = null;
    };
  }, [bridge, id]);

  React.useEffect(() => {
    if (xterm.current) xterm.current.options.theme = dark ? DARK : LIGHT;
  }, [dark]);

  return <div ref={container} className="size-full px-2 pt-1" />;
}

/** All terminals, kept in sync with the main process. */
function useTerminals(bridge: DesktopBridge) {
  const [terminals, setTerminals] = React.useState<TerminalInfo[] | null>(null);
  React.useEffect(() => {
    const unsubscribe = bridge.terminal.onChanged(setTerminals);
    bridge.terminal
      .list()
      .then(setTerminals)
      .catch((error: Error) => toast.error(error.message));
    return unsubscribe;
  }, [bridge]);
  return terminals;
}

/** The open conversation's workspace terminals, as tabs; a first one opens by itself. */
export function TerminalPanel({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("chat");
  const workspaceDir = useChatStore((state) => state.workspaceDir);
  const all = useTerminals(bridge);
  const terminals = React.useMemo(
    () => (all ?? []).filter((terminal) => terminal.cwd === workspaceDir),
    [all, workspaceDir],
  );
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const active = terminals.find((terminal) => terminal.id === activeId) ?? terminals.at(-1) ?? null;
  // Opened automatically at most once per workspace, so closing the last one sticks.
  const autoOpened = React.useRef(new Set<string>());

  const create = React.useCallback(async () => {
    if (!workspaceDir) return;
    try {
      const created = await bridge.terminal.create(workspaceDir, { cols: 80, rows: 24 });
      setActiveId(created.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [bridge, workspaceDir]);

  React.useEffect(() => {
    if (all === null || !workspaceDir || terminals.length > 0) return;
    if (autoOpened.current.has(workspaceDir)) return;
    autoOpened.current.add(workspaceDir);
    void create();
  }, [all, workspaceDir, terminals.length, create]);

  if (!workspaceDir) return null;
  if (all !== null && terminals.length === 0) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SquareTerminalIcon />
          </EmptyMedia>
          <EmptyTitle>{t("panel.terminal.emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("panel.terminal.emptyDescription")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => void create()}>
            <PlusIcon />
            {t("panel.terminal.new")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelTabs>
        {terminals.map((terminal, index) => (
          <PanelTab
            key={terminal.id}
            active={terminal.id === active?.id}
            icon={<SquareTerminalIcon />}
            label={t("panel.terminal.tab", { name: terminal.title, number: index + 1 })}
            badge={terminal.exited && <span>{t("panel.terminal.ended")}</span>}
            closeLabel={t("panel.terminal.close")}
            onSelect={() => setActiveId(terminal.id)}
            onClose={() =>
              bridge.terminal.close(terminal.id).catch((error: Error) => toast.error(error.message))
            }
          />
        ))}
        <NewTabButton label={t("panel.terminal.new")} onClick={() => void create()} />
      </PanelTabs>
      <div className="min-h-0 flex-1 overflow-hidden">
        {active && <XtermView key={active.id} bridge={bridge} terminal={active} />}
      </div>
    </div>
  );
}
