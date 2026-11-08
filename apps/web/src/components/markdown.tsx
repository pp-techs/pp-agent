import * as React from "react";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@workspace/ui/components/code-block";
import {
  defaultRehypePlugins,
  Streamdown,
  useIsCodeFenceIncomplete,
  type ExtraProps,
} from "streamdown";

import { isVisualLanguage, VisualCodeBlock } from "@/components/visual-preview";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";

function MarkdownCodeBlock({ code, language }: { code: string; language: string }) {
  // True while the closing fence has not arrived yet.
  const incomplete = useIsCodeFenceIncomplete();
  // Diagrams, pictures and HTML are drawn once the whole block has arrived.
  if (!incomplete && isVisualLanguage(language))
    return <VisualCodeBlock code={code} language={language} />;
  return <HighlightedCodeBlock code={code} language={language} incomplete={incomplete} />;
}

function HighlightedCodeBlock({
  code,
  language,
  incomplete,
}: {
  code: string;
  language: string;
  incomplete: boolean;
}) {
  const lines = useHighlightedCode(code, language, incomplete);
  return (
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>{language || "text"}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} disabled={incomplete} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function MarkdownCode({
  node: _node,
  className,
  children,
  ...props
}: React.ComponentProps<"code"> & ExtraProps) {
  // Streamdown marks fenced code with data-block. Everything else is inline.
  if (!("data-block" in props)) {
    return (
      <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]" {...props}>
        {children}
      </code>
    );
  }

  return (
    <MarkdownCodeBlock
      code={typeof children === "string" ? children : ""}
      language={/language-(\S+)/.exec(className ?? "")?.[1] ?? ""}
    />
  );
}

const components = { code: MarkdownCode };

type RehypePlugins = NonNullable<React.ComponentProps<typeof Streamdown>["rehypePlugins"]>;

/**
 * Streamdown's own plugins, with images limited to ones already in the message (`data:` and
 * `blob:`). An image from the web would load the moment the reply shows it, so a prompt-injected
 * model could send what it read to any server inside the image's address. A blocked image shows
 * its description instead. Links keep Streamdown's defaults.
 */
const rehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [
    (defaultRehypePlugins.harden as unknown[])[0],
    {
      allowedImagePrefixes: [],
      allowDataImages: true,
      allowedLinkPrefixes: ["*"],
      allowedProtocols: ["*"],
      imageBlockPolicy: "text-only",
    },
  ],
] as RehypePlugins;

export function Markdown({ children, streaming }: { children: string; streaming?: boolean }) {
  return (
    <Streamdown
      controls={false}
      components={components}
      rehypePlugins={rehypePlugins}
      isAnimating={streaming}
    >
      {children}
    </Streamdown>
  );
}
