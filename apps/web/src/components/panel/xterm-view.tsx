import * as React from "react";
import type { DesktopBridge, TerminalInfo } from "@workspace/shared";
import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { toast } from "sonner";

import { useIsDark } from "@/hooks/use-is-dark";

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
export function XtermView({ bridge, terminal }: { bridge: DesktopBridge; terminal: TerminalInfo }) {
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
    // backlog already holds are skipped by their sequence number. Every chunk after the backlog
    // is acked once xterm has drawn it, so the main process can pause a shell that outruns it.
    let shown = -1;
    const early: Array<{ data: string; seq: number }> = [];
    const show = (data: string) => term.write(data, () => bridge.terminal.ack(id, data.length));
    const unsubscribe = bridge.terminal.onData((terminalId, data, seq) => {
      if (terminalId !== id) return;
      if (shown < 0) early.push({ data, seq });
      else if (seq > shown) {
        shown = seq;
        show(data);
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
            show(chunk.data);
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
      bridge.terminal.detach(id);
      term.dispose();
      xterm.current = null;
    };
  }, [bridge, id]);

  React.useEffect(() => {
    if (xterm.current) xterm.current.options.theme = dark ? DARK : LIGHT;
  }, [dark]);

  return <div ref={container} className="size-full px-2 pt-1" />;
}
