import * as React from "react";
import { useTranslation } from "react-i18next";

// The renderer carries streamdown (about 500 KB), which the first screen does not need: the
// sidebar, an empty chat and the composer draw without it. Keeping it out of the first load made
// the desktop window's DOMContentLoaded about 15 ms quicker. It loads right after the first paint
// (`preloadMarkdown`), so by the time a reply shows it is already there.
let loading: Promise<typeof import("@/components/markdown-renderer")> | undefined;
const loadRenderer = () => {
  loading ??= import("@/components/markdown-renderer");
  return loading;
};

const Renderer = React.lazy(() =>
  loadRenderer().then((module) => ({ default: module.MarkdownRenderer })),
);

/** Starts loading the markdown renderer, so a message that shows later finds it ready. */
export function preloadMarkdown(): void {
  loadRenderer().catch(() => undefined);
}

function MarkdownFailure({ text }: { text: string }) {
  const { t } = useTranslation("chat");
  return (
    <div className="flex flex-col gap-2">
      <div className="whitespace-pre-wrap">{text}</div>
      <div role="alert" className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{t("message.markdownFailed")}</span>
        <button
          type="button"
          className="underline underline-offset-2"
          // A browser keeps a module that failed to load for the life of the page, so only a
          // reload fetches it again.
          onClick={() => location.reload()}
        >
          {t("message.markdownRetry")}
        </button>
      </div>
    </div>
  );
}

/**
 * Shows the text itself, with a way to reload the app, when the renderer's chunk cannot be loaded
 * (offline, or the app was updated underneath the page). Without it the rejection would reach the
 * root and clear the whole app.
 */
class RendererBoundary extends React.Component<
  { text: string; children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) return <MarkdownFailure text={this.props.text} />;
    return this.props.children;
  }
}

/**
 * Markdown as it reads. A message drawn before the renderer has loaded (a chat restored at
 * startup) holds its place, invisible, rather than showing the raw markup for a moment.
 */
export function Markdown({ children, streaming }: { children: string; streaming?: boolean }) {
  return (
    <RendererBoundary text={children}>
      <React.Suspense
        fallback={
          <div aria-hidden className="whitespace-pre-wrap opacity-0">
            {children}
          </div>
        }
      >
        <Renderer streaming={streaming}>{children}</Renderer>
      </React.Suspense>
    </RendererBoundary>
  );
}
