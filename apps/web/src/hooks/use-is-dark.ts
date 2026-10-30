import * as React from "react";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains("dark");

/**
 * Whether the dark theme is showing (the `dark` class the theme provider sets on `<html>`), for
 * things drawn outside CSS such as the terminal.
 */
export function useIsDark(): boolean {
  return React.useSyncExternalStore(subscribe, isDark);
}
