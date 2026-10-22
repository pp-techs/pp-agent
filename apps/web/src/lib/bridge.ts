import type { DesktopBridge } from "@workspace/shared";

declare global {
  interface Window {
    /** Injected by the desktop preload script; absent when the renderer runs in a plain browser. */
    ppAgent?: DesktopBridge;
  }
}

export const bridge = window.ppAgent ?? null;
