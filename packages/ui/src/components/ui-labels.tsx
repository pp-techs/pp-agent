import * as React from "react";

/** Screen-reader and tooltip texts the UI components render themselves. */
export type UiLabels = {
  close: string;
  toggleSidebar: string;
  sidebarMobileTitle: string;
  sidebarMobileDescription: string;
  loading: string;
  copy: string;
  copied: string;
  scrollToEnd: string;
  scrollToStart: string;
};

export const defaultUiLabels: UiLabels = {
  close: "Close",
  toggleSidebar: "Toggle Sidebar",
  sidebarMobileTitle: "Sidebar",
  sidebarMobileDescription: "Displays the mobile sidebar.",
  loading: "Loading",
  copy: "Copy",
  copied: "Copied",
  scrollToEnd: "Scroll to end",
  scrollToStart: "Scroll to start",
};

const UiLabelsContext = React.createContext<UiLabels>(defaultUiLabels);

/** Supplies translated texts to every UI component below it. */
function UiLabelsProvider({ labels, children }: { labels: UiLabels; children: React.ReactNode }) {
  return <UiLabelsContext.Provider value={labels}>{children}</UiLabelsContext.Provider>;
}

/** The current labels; English defaults without a provider. */
function useUiLabels(): UiLabels {
  return React.useContext(UiLabelsContext);
}

export { UiLabelsProvider, useUiLabels };
