import type { BrowserState, DesktopBridge, TerminalInfo } from "@workspace/shared";
import { BrowserView } from "@/components/panel/browser-view";
import { FilePreviewView } from "@/components/panel/files-panel";
import { XtermView } from "@/components/panel/xterm-view";
import { newBrowserTab } from "@/lib/workbench-actions";
import type { CenterTab } from "@/stores/workbench-store";

/**
 * What a main-area tab shows: the same views as the side panel's tools, for one file, terminal or
 * browser tab. Loaded on first use, like the tools themselves (xterm.js alone is a few hundred KB).
 */
export default function TabContent({
  bridge,
  root,
  tab,
  terminals,
  browser,
  hidden,
}: {
  bridge: DesktopBridge;
  root: string;
  tab: Exclude<CenterTab, { kind: "chat" }>;
  terminals: TerminalInfo[] | null;
  browser: BrowserState | null;
  /** Hides a browser page while a drag passes over it. */
  hidden: boolean;
}) {
  switch (tab.kind) {
    case "file":
      return <FilePreviewView bridge={bridge} root={root} path={tab.path} />;
    case "terminal": {
      const terminal = terminals?.find((item) => item.id === tab.id);
      return terminal ? <XtermView bridge={bridge} terminal={terminal} /> : null;
    }
    case "browser": {
      const page = browser?.tabs.find((item) => item.id === tab.id) ?? null;
      if (!page) return null;
      return (
        <BrowserView
          bridge={bridge}
          tab={page}
          hidden={hidden}
          onOpen={(profileId, url) => void newBrowserTab(bridge, root, profileId, url)}
        />
      );
    }
  }
}
