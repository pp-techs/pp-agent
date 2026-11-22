import * as React from "react";
import type { RunSpan } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { CheckIcon, CopyIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatDuration, spanDuration, STATUS_DOT } from "@/components/run/run-model";

function Block({ title, text }: { title: string; text: string }) {
  const { t } = useTranslation("chat");
  const [copied, setCopied] = React.useState(false);
  return (
    <section className="space-y-1">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={copied ? t("run.detail.copied") : t("run.detail.copy")}
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] break-words whitespace-pre-wrap">
        {text}
      </pre>
    </section>
  );
}

/** What one span is: its status and timing, and what went in and came out. */
export function SpanDetail({
  span,
  now,
  onClose,
}: {
  span: RunSpan;
  now: number;
  onClose: () => void;
}) {
  const { t } = useTranslation("chat");
  const rows: [string, string][] = [
    [t("run.detail.started"), new Date(span.startedAt).toLocaleTimeString()],
    [t("run.detail.duration"), formatDuration(spanDuration(span, now))],
  ];
  if (span.model) rows.push([t("run.detail.model"), span.model]);
  if (span.target && span.kind === "tool") rows.push([t("run.detail.target"), span.target]);
  if (span.usage) rows.push([t("run.detail.tokens"), `${span.usage.input} / ${span.usage.output}`]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{t(`run.kind.${span.kind}`)}</div>
          <div className="truncate font-mono text-sm font-medium" title={span.name}>
            {span.name}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <span className={`size-2 rounded-full ${STATUS_DOT[span.status]}`} />
            {t(`run.status.${span.status}`)}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t("run.detail.close")} onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map(([key, value]) => (
            <React.Fragment key={key}>
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="truncate" title={value}>
                {value}
              </dd>
            </React.Fragment>
          ))}
        </dl>
        {span.error && <Block title={t("run.detail.error")} text={span.error} />}
        {span.args && (
          <Block
            title={
              span.kind === "agent"
                ? t("run.detail.task")
                : span.kind === "step"
                  ? t("run.detail.thinking")
                  : t("run.detail.args")
            }
            text={span.args}
          />
        )}
        {span.output && (
          <Block
            title={span.kind === "step" ? t("run.detail.reply") : t("run.detail.output")}
            text={span.output}
          />
        )}
      </div>
    </div>
  );
}
