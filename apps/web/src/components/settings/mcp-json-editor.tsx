import * as React from "react";
import type { DesktopBridge } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@workspace/ui/components/field";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { ArrowLeftIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import { mcpJsonQuery, useSaveMcpJson } from "@/lib/extension-queries";

function parseError(text: string) {
  if (!text.trim()) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function JsonForm({
  bridge,
  initialText,
  onDone,
}: {
  bridge: DesktopBridge;
  initialText: string;
  onDone: () => void;
}) {
  const { t } = useTranslation(["extensions", "common"]);
  const [text, setText] = React.useState(initialText);
  const save = useSaveMcpJson(bridge);
  const error = parseError(text);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (error) return;
    save.mutate(text, {
      onSuccess: () => {
        toast.success(t("mcpJson.saved"));
        onDone();
      },
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="mcp-json" className="sr-only">
          mcp.json
        </FieldLabel>
        <Textarea
          id="mcp-json"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'{\n  "mcpServers": {}\n}'}
          spellCheck={false}
          aria-invalid={Boolean(error)}
          className="min-h-96 resize-y font-mono text-xs md:text-xs"
        />
        {error ? (
          <FieldError>{t("mcpJson.invalid", { error })}</FieldError>
        ) : (
          <FieldDescription>
            <Trans t={t} i18nKey="mcpJson.hint" components={{ code: <code /> }} />
          </FieldDescription>
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" disabled={Boolean(error) || save.isPending}>
          {save.isPending && <Spinner />}
          {t("common:actions.save")}
        </Button>
      </div>
    </form>
  );
}

/** Raw mcp.json editor for people who have a config to paste. */
export function McpJsonEditor({ bridge, onDone }: { bridge: DesktopBridge; onDone: () => void }) {
  const { t } = useTranslation(["extensions", "common"]);
  const json = useQuery(mcpJsonQuery(bridge));
  useSettingsSubPage("mcp.json");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t("mcp.backToServers")} onClick={onDone}>
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-base font-medium">{t("mcp.editJson")}</h2>
          <p className="text-sm text-muted-foreground">{t("mcpJson.intro")}</p>
        </div>
      </header>
      {json.isPending ? (
        <Spinner />
      ) : json.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("mcpJson.openError")}</AlertTitle>
          <AlertDescription>{json.error.message}</AlertDescription>
        </Alert>
      ) : (
        <JsonForm bridge={bridge} initialText={json.data} onDone={onDone} />
      )}
    </div>
  );
}
