import * as React from "react";
import {
  MCP_EXPOSURES,
  type DesktopBridge,
  type McpExposure,
  type McpServerSettings,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Textarea } from "@workspace/ui/components/textarea";
import { ArrowLeftIcon, GlobeIcon, PlusIcon, TerminalIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { OptionGroup } from "@/components/settings/option-group";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import { useSaveMcpServer } from "@/lib/extension-queries";

/** Connection details belong to the transport tabs above them: indented behind a subtle rule. */
const NESTED_PANEL = "mt-1 ml-1 border-l border-border/70 py-1 pl-4";

type Pair = { id: number; key: string; value: string };

let nextPairId = 0;
function toPairs(record: Record<string, string> | undefined): Pair[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ id: nextPairId++, key, value }));
}

/** Rows with an empty name are dropped; returns undefined when nothing is left. */
function fromPairs(pairs: Pair[]) {
  const entries = pairs
    .map((pair) => [pair.key.trim(), pair.value] as const)
    .filter(([key]) => key !== "");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function KeyValueList({
  pairs,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  pairs: Pair[];
  onChange: (pairs: Pair[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
}) {
  const { t } = useTranslation(["extensions", "common"]);
  function update(id: number, patch: Partial<Pair>) {
    onChange(pairs.map((pair) => (pair.id === id ? { ...pair, ...patch } : pair)));
  }
  return (
    <div className="flex flex-col gap-2">
      {pairs.map((pair) => (
        <div key={pair.id} className="flex items-center gap-2">
          <Input
            value={pair.key}
            onChange={(event) => update(pair.id, { key: event.target.value })}
            placeholder={keyPlaceholder}
            aria-label={t("mcpForm.keyValue.name")}
            autoComplete="off"
            spellCheck={false}
            className="w-2/5 font-mono"
          />
          <Input
            value={pair.value}
            onChange={(event) => update(pair.id, { value: event.target.value })}
            placeholder={valuePlaceholder}
            aria-label={t("mcpForm.keyValue.value")}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 font-mono"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("common:actions.remove")}
            onClick={() => onChange(pairs.filter((item) => item.id !== pair.id))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...pairs, { id: nextPairId++, key: "", value: "" }])}
      >
        <PlusIcon />
        {addLabel}
      </Button>
    </div>
  );
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** In-pane form to add a server (`server` omitted) or edit one. */
export function McpServerForm({
  bridge,
  server,
  existingNames,
  onDone,
}: {
  bridge: DesktopBridge;
  server?: McpServerSettings;
  existingNames: string[];
  onDone: () => void;
}) {
  const { t } = useTranslation(["extensions", "common"]);
  const [name, setName] = React.useState(server?.name ?? "");
  const [description, setDescription] = React.useState(server?.description ?? "");
  const [transport, setTransport] = React.useState<McpServerSettings["transport"]>(
    server?.transport ?? "stdio",
  );
  const [command, setCommand] = React.useState(server?.command ?? "");
  const [argsText, setArgsText] = React.useState((server?.args ?? []).join("\n"));
  const [env, setEnv] = React.useState(() => toPairs(server?.env));
  const [cwd, setCwd] = React.useState(server?.cwd ?? "");
  const [url, setUrl] = React.useState(server?.url ?? "");
  const [headers, setHeaders] = React.useState(() => toPairs(server?.headers));
  const [exposure, setExposure] = React.useState<McpExposure>(server?.exposure ?? "codemode");
  const [timeoutText, setTimeoutText] = React.useState(server?.timeout?.toString() ?? "");
  const [touched, setTouched] = React.useState(false);
  const save = useSaveMcpServer(bridge);
  const exposureItems = MCP_EXPOSURES.map((value) => ({
    value,
    label: t(`mcpForm.exposure.${value}.label`),
  }));
  useSettingsSubPage(server?.name ?? t("mcp.addServer"));

  const trimmedName = name.trim();
  const timeoutValue = timeoutText.trim() === "" ? undefined : Number(timeoutText);
  const errors = {
    name: !trimmedName
      ? t("mcpForm.validation.nameRequired")
      : !/^[A-Za-z0-9_-]+$/.test(trimmedName)
        ? t("mcpForm.validation.nameFormat")
        : trimmedName !== server?.name && existingNames.includes(trimmedName)
          ? t("mcpForm.validation.nameTaken")
          : null,
    command:
      transport === "stdio" && !command.trim() ? t("mcpForm.validation.commandRequired") : null,
    url: transport === "http" && !isHttpUrl(url.trim()) ? t("mcpForm.validation.urlInvalid") : null,
    timeout:
      timeoutValue !== undefined && !(Number.isFinite(timeoutValue) && timeoutValue > 0)
        ? t("mcpForm.validation.timeoutInvalid")
        : null,
  };
  const valid = Object.values(errors).every((error) => error === null);
  const show = (error: string | null) => (touched ? error : null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    const args = argsText
      .split("\n")
      .map((arg) => arg.trim())
      .filter((arg) => arg !== "");
    const next: McpServerSettings = {
      name: trimmedName,
      description: description.trim() || undefined,
      enabled: server?.enabled ?? true,
      exposure,
      timeout: timeoutValue,
      transport,
      ...(transport === "stdio"
        ? {
            command: command.trim(),
            args: args.length > 0 ? args : undefined,
            env: fromPairs(env),
            cwd: cwd.trim() || undefined,
          }
        : { url: url.trim(), headers: fromPairs(headers) }),
    };
    save.mutate(
      { originalName: server?.name, server: next },
      {
        onSuccess: () => {
          toast.success(
            t(server ? "mcpForm.toast.saved" : "mcpForm.toast.added", { name: next.name }),
          );
          onDone();
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <Button variant="ghost" size="icon-sm" aria-label={t("mcp.backToServers")} onClick={onDone}>
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-base font-medium">
            {server ? t("mcpForm.editTitle", { name: server.name }) : t("mcpForm.addTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("mcpForm.intro")}</p>
        </div>
      </header>
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <FieldGroup>
          <Field data-invalid={Boolean(show(errors.name))}>
            <FieldLabel htmlFor="mcp-name">{t("mcpForm.fields.name.label")}</FieldLabel>
            <Input
              id="mcp-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="crm"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(show(errors.name))}
            />
            {show(errors.name) ? (
              <FieldError>{errors.name}</FieldError>
            ) : (
              <FieldDescription>{t("mcpForm.fields.name.hint")}</FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-description">
              {t("mcpForm.fields.description.label")}
            </FieldLabel>
            <Input
              id="mcp-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("mcpForm.fields.description.placeholder")}
            />
            <FieldDescription>{t("mcpForm.fields.description.hint")}</FieldDescription>
          </Field>

          <OptionGroup legend={t("mcpForm.connect.legend")}>
            <Tabs
              value={transport}
              onValueChange={(value) => setTransport(value === "http" ? "http" : "stdio")}
            >
              <TabsList>
                <TabsTrigger value="stdio">
                  <TerminalIcon />
                  {t("mcpForm.connect.local")}
                </TabsTrigger>
                <TabsTrigger value="http">
                  <GlobeIcon />
                  {t("mcpForm.connect.remote")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="stdio" className={NESTED_PANEL}>
                <FieldGroup>
                  <Field data-invalid={Boolean(show(errors.command))}>
                    <FieldLabel htmlFor="mcp-command">
                      {t("mcpForm.fields.command.label")}
                    </FieldLabel>
                    <Input
                      id="mcp-command"
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      placeholder="npx"
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                      aria-invalid={Boolean(show(errors.command))}
                    />
                    {show(errors.command) ? (
                      <FieldError>{errors.command}</FieldError>
                    ) : (
                      <FieldDescription>{t("mcpForm.fields.command.hint")}</FieldDescription>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mcp-args">{t("mcpForm.fields.args.label")}</FieldLabel>
                    <Textarea
                      id="mcp-args"
                      value={argsText}
                      onChange={(event) => setArgsText(event.target.value)}
                      placeholder={"-y\n@modelcontextprotocol/server-filesystem"}
                      spellCheck={false}
                      className="min-h-20 resize-y font-mono text-xs md:text-xs"
                    />
                    <FieldDescription>{t("mcpForm.fields.args.hint")}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>{t("mcpForm.fields.env.label")}</FieldLabel>
                    <KeyValueList
                      pairs={env}
                      onChange={setEnv}
                      keyPlaceholder="API_TOKEN"
                      valuePlaceholder={t("mcpForm.keyValue.value")}
                      addLabel={t("mcpForm.fields.env.add")}
                    />
                    <FieldDescription>{t("mcpForm.fields.env.hint")}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mcp-cwd">{t("mcpForm.fields.cwd.label")}</FieldLabel>
                    <Input
                      id="mcp-cwd"
                      value={cwd}
                      onChange={(event) => setCwd(event.target.value)}
                      placeholder="/path/to/folder"
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono"
                    />
                  </Field>
                </FieldGroup>
              </TabsContent>
              <TabsContent value="http" className={NESTED_PANEL}>
                <FieldGroup>
                  <Field data-invalid={Boolean(show(errors.url))}>
                    <FieldLabel htmlFor="mcp-url">{t("mcpForm.fields.url.label")}</FieldLabel>
                    <Input
                      id="mcp-url"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://mcp.example.com/mcp"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={Boolean(show(errors.url))}
                    />
                    {show(errors.url) ? (
                      <FieldError>{errors.url}</FieldError>
                    ) : (
                      <FieldDescription>{t("mcpForm.fields.url.hint")}</FieldDescription>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel>{t("mcpForm.fields.headers.label")}</FieldLabel>
                    <KeyValueList
                      pairs={headers}
                      onChange={setHeaders}
                      keyPlaceholder="Authorization"
                      valuePlaceholder="Bearer …"
                      addLabel={t("mcpForm.fields.headers.add")}
                    />
                    <FieldDescription>{t("mcpForm.fields.headers.hint")}</FieldDescription>
                  </Field>
                </FieldGroup>
              </TabsContent>
            </Tabs>
          </OptionGroup>

          <Field>
            <FieldLabel>{t("mcpForm.fields.exposure.label")}</FieldLabel>
            <Select
              items={exposureItems}
              value={exposure}
              onValueChange={(value) => value && setExposure(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {exposureItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{t(`mcpForm.exposure.${exposure}.description`)}</FieldDescription>
          </Field>
          <Field data-invalid={Boolean(show(errors.timeout))}>
            <FieldLabel htmlFor="mcp-timeout">{t("mcpForm.fields.timeout.label")}</FieldLabel>
            <Input
              id="mcp-timeout"
              type="number"
              min={1}
              inputMode="numeric"
              value={timeoutText}
              onChange={(event) => setTimeoutText(event.target.value)}
              placeholder={t("mcpForm.fields.timeout.placeholder")}
              className="w-40"
              aria-invalid={Boolean(show(errors.timeout))}
            />
            {show(errors.timeout) ? (
              <FieldError>{errors.timeout}</FieldError>
            ) : (
              <FieldDescription>{t("mcpForm.fields.timeout.hint")}</FieldDescription>
            )}
          </Field>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            {t("common:actions.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending || (touched && !valid)}>
            {save.isPending && <Spinner />}
            {server ? t("saveChanges") : t("mcp.addServer")}
          </Button>
        </div>
      </form>
    </div>
  );
}
