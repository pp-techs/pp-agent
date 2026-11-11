import * as React from "react";

// The renderer carries streamdown (about 500 KB), which the first screen does not need: the
// sidebar, an empty chat and the composer draw without it. Keeping it out of the first load made
// the desktop window's DOMContentLoaded about 15 ms quicker. It loads right after the first paint
// (`preloadMarkdown`), so by the time a reply shows it is already there.
const loadRenderer = () => import("@/components/markdown-renderer");
const Renderer = React.lazy(() =>
  loadRenderer().then((module) => ({ default: module.MarkdownRenderer })),
);

/** Starts loading the markdown renderer, so a message that shows later finds it ready. */
export function preloadMarkdown(): void {
  void loadRenderer();
}

/**
 * Markdown as it reads. A message drawn before the renderer has loaded (a chat restored at
 * startup) holds its place, invisible, rather than showing the raw markup for a moment.
 */
export function Markdown({ children, streaming }: { children: string; streaming?: boolean }) {
  return (
    <React.Suspense
      fallback={
        <div aria-hidden className="whitespace-pre-wrap opacity-0">
          {children}
        </div>
      }
    >
      <Renderer streaming={streaming}>{children}</Renderer>
    </React.Suspense>
  );
}
