import type { BrowserTab } from "@workspace/shared";

/** A tab's title, else its site, else `fallback` (a tab that has not loaded anything). */
export function tabLabel(tab: BrowserTab, fallback: string): string {
  if (tab.title) return tab.title;
  if (URL.canParse(tab.url)) return new URL(tab.url).hostname;
  return fallback;
}

const awaitingFocus = new Set<string>();

/** A tab the person just opened with no address: its address bar takes the keyboard once shown. */
export function focusAddressOnShow(tabId: string): void {
  awaitingFocus.add(tabId);
}

/** Whether the address bar of a tab should take the keyboard now (once). */
export function takeAddressFocus(tabId: string): boolean {
  return awaitingFocus.delete(tabId);
}
