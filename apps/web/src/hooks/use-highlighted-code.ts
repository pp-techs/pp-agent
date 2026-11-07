import * as React from "react";

import { loadHighlighter } from "@/lib/highlighter";

/**
 * `value` split into lines, highlighted once the language has loaded. A block that is complete
 * when it mounts is highlighted in a transition, so opening a long chat paints its text first and
 * tokenizes the blocks without freezing the window; a block still being written (`streaming`)
 * highlights at once and then line by line.
 */
export function useHighlightedCode(value: string, language: string, streaming = false) {
  // A trailing newline would render as an extra empty line.
  const code = value.endsWith("\n") ? value.slice(0, -1) : value;
  const [loaded, setLoaded] = React.useState<{
    language: string;
    highlighter: Awaited<ReturnType<typeof loadHighlighter>>;
  } | null>(null);
  const highlighter = loaded?.language === language ? loaded.highlighter : null;
  const streamingRef = React.useRef(streaming);
  // Declared before the loading effect, so it runs first.
  React.useEffect(() => {
    streamingRef.current = streaming;
  });

  React.useEffect(() => {
    let cancelled = false;

    loadHighlighter(language)
      .then((next) => {
        if (cancelled) return;
        const apply = () => setLoaded({ language, highlighter: next });
        if (streamingRef.current) apply();
        else React.startTransition(apply);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [language]);

  // The complete lines, highlighted. While the code streams, only the new
  // lines are tokenized, starting from the grammar state of the last one.
  const [done, setDone] = React.useState<{
    highlighter: typeof highlighter;
    text: string;
    lines: React.ReactNode[];
    state?: Parameters<NonNullable<typeof highlighter>["highlight"]>[1];
  }>({ highlighter: null, text: "", lines: [] });

  let next = done;

  if (next.highlighter !== highlighter || !code.startsWith(next.text)) {
    next = { highlighter, text: "", lines: [] };
  }

  const end = code.lastIndexOf("\n") + 1;

  if (highlighter && end > next.text.length) {
    const result = highlighter.highlight(code.slice(next.text.length, end - 1), next.state);

    next = {
      highlighter,
      text: code.slice(0, end),
      lines: [...next.lines, ...result.lines],
      state: result.state,
    };
  }

  if (next !== done) {
    setDone(next);
  }

  // The last line is still being written, so it is tokenized on every render.
  const tail = code.slice(end);

  return React.useMemo(() => {
    if (!highlighter) {
      return code.split("\n");
    }

    return [...next.lines, highlighter.highlight(tail, next.state).lines[0]];
  }, [code, highlighter, next, tail]);
}
