import * as React from "react";

export interface HistoryEntry {
  url: string;
  title: string;
  visits: number;
  last: number;
}

const KEY = "pp.browser.history";
const MAX = 200;
const listeners = new Set<() => void>();
let cache: HistoryEntry[] | null = null;

function load(): HistoryEntry[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function save(next: HistoryEntry[]): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable; the history then lasts until the window closes.
  }
  for (const listener of listeners) listener();
}

/** The site's origin: one tile per site, not per page. */
function siteOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
}

export function recordVisit(url: string, title: string): void {
  const site = siteOf(url);
  if (!site) return;
  const list = load();
  const found = list.find((entry) => entry.url === site);
  const entry: HistoryEntry = {
    url: site,
    title: found?.title || (new URL(url).pathname === "/" ? title : "") || "",
    visits: (found?.visits ?? 0) + 1,
    last: Date.now(),
  };
  if (!entry.title && title && new URL(url).pathname === "/") entry.title = title;
  save([entry, ...list.filter((item) => item.url !== site)].slice(0, MAX));
}

export function removeSite(url: string): HistoryEntry | undefined {
  const removed = load().find((entry) => entry.url === url);
  if (removed) save(load().filter((entry) => entry.url !== url));
  return removed;
}

export function restoreSite(entry: HistoryEntry): void {
  if (!load().some((item) => item.url === entry.url)) save([...load(), entry]);
}

/** The most visited sites, the recent ones first among equals. */
export function topSites(limit: number): HistoryEntry[] {
  return [...load()].sort((a, b) => b.visits - a.visits || b.last - a.last).slice(0, limit);
}

export function useHistoryVersion(): HistoryEntry[] {
  return React.useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, load);
}
