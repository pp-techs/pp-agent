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
import { toast } from "sonner";

import { OptionGroup } from "@/components/settings/option-group";
import { useSettingsSubPage } from "@/components/settings/settings-subpage";
import { useSaveMcpServer } from "@/lib/extension-queries";

/** Connection details belong to the transport tabs above them: indented behind a subtle rule. */
const NESTED_PANEL = "mt-1 ml-1 border-l border-border/70 py-1 pl-4";

const EXPOSURE_INFO: Record<McpExposure, { label: string; description: string }> = {
  codemode: {
    label: "Through scripts (recommended)",
    description:
      "The agent combines this server's tools in small scripts. Works well even with many tools.",
  },
  deferred: {
    label: "On demand",
    description: "The agent looks up this server's tools when it needs them.",
  },
  direct: {
    label: "Always available",
    description:
      "Every tool is offered to the agent all the time. Best for servers with few tools.",
  },
  hidden: {
    label: "Hidden",
    description: "The server stays connected, but the agent can't see its tools.",
  },
};
const EXPOSURE_ITEMS = MCP_EXPOSURES.map((value) => ({
  value,
  label: EXPOSURE_INFO[value].label,
}));

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
            aria-label="Name"
            autoComplete="off"
            spellCheck={false}
            className="w-2/5 font-mono"
          />
          <Input
            value={pair.value}
            onChange={(event) => update(pair.id, { value: event.target.value })}
            placeholder={valuePlaceholder}
            aria-label="Value"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 font-mono"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove"
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
  useSettingsSubPage(server?.name ?? "Add server");

  const trimmedName = name.trim();
  const timeoutValue = timeoutText.trim() === "" ? undefined : Number(timeoutText);
  const errors = {
    name: !trimmedName
      ? "Give the server a name."
      : !/^[A-Za-z0-9_-]+$/.test(trimmedName)
        ? "Use only letters, digits, underscores (_), and hyphens (-)."
        : trimmedName !== server?.name && existingNames.includes(trimmedName)
          ? "Another server already uses this name."
          : null,
    command: transport === "stdio" && !command.trim() ? "Enter the command to run." : null,
    url:
      transport === "http" && !isHttpUrl(url.trim())
        ? "Enter a web address starting with https:// or http://."
        : null,
    timeout:
      timeoutValue !== undefined && !(Number.isFinite(timeoutValue) && timeoutValue > 0)
        ? "Enter a number of seconds, or leave it empty."
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
          toast.success(server ? `“${next.name}” saved` : `“${next.name}” added`);
          onDone();
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to MCP servers" onClick={onDone}>
          <ArrowLeftIcon />
        </Button>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-heading text-base font-medium">
            {server ? `Edit “${server.name}”` : "Add MCP server"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Copy these details from the server's setup guide, or ask your tech team.
          </p>
        </div>
      </header>
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <FieldGroup>
          <Field data-invalid={Boolean(show(errors.name))}>
            <FieldLabel htmlFor="mcp-name">Name</FieldLabel>
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
              <FieldDescription>
                A short name, shown next to the server's tools. Letters, digits, _ and -.
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="mcp-description">Description (optional)</FieldLabel>
            <Input
              id="mcp-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Customer records and deals"
            />
            <FieldDescription>Helps the agent understand what this server is for.</FieldDescription>
          </Field>

          <OptionGroup legend="How to connect">
            <Tabs
              value={transport}
              onValueChange={(value) => setTransport(value === "http" ? "http" : "stdio")}
            >
              <TabsList>
                <TabsTrigger value="stdio">
                  <TerminalIcon />
                  Local command
                </TabsTrigger>
                <TabsTrigger value="http">
                  <GlobeIcon />
                  Remote URL
                </TabsTrigger>
              </TabsList>
              <TabsContent value="stdio" className={NESTED_PANEL}>
                <FieldGroup>
                  <Field data-invalid={Boolean(show(errors.command))}>
                    <FieldLabel htmlFor="mcp-command">Command</FieldLabel>
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
                      <FieldDescription>
                        The program that starts the server on this computer.
                      </FieldDescription>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mcp-args">Arguments</FieldLabel>
                    <Textarea
                      id="mcp-args"
                      value={argsText}
                      onChange={(event) => setArgsText(event.target.value)}
                      placeholder={"-y\n@modelcontextprotocol/server-filesystem"}
                      spellCheck={false}
                      className="min-h-20 resize-y font-mono text-xs md:text-xs"
                    />
                    <FieldDescription>One per line.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Environment variables</FieldLabel>
                    <KeyValueList
                      pairs={env}
                      onChange={setEnv}
                      keyPlaceholder="API_TOKEN"
                      valuePlaceholder="Value"
                      addLabel="Add variable"
                    />
                    <FieldDescription>
                      Settings the server reads when it starts, such as access tokens.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mcp-cwd">Working folder (optional)</FieldLabel>
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
                    <FieldLabel htmlFor="mcp-url">Server URL</FieldLabel>
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
                      <FieldDescription>
                        If the server needs you to sign in, leave the headers empty and use “Sign
                        in” after saving.
                      </FieldDescription>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel>Headers</FieldLabel>
                    <KeyValueList
                      pairs={headers}
                      onChange={setHeaders}
                      keyPlaceholder="Authorization"
                      valuePlaceholder="Bearer …"
                      addLabel="Add header"
                    />
                    <FieldDescription>
                      Sent with every request, for example an API key.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </TabsContent>
            </Tabs>
          </OptionGroup>

          <Field>
            <FieldLabel>How the agent sees its tools</FieldLabel>
            <Select
              items={EXPOSURE_ITEMS}
              value={exposure}
              onValueChange={(value) => value && setExposure(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPOSURE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{EXPOSURE_INFO[exposure].description}</FieldDescription>
          </Field>
          <Field data-invalid={Boolean(show(errors.timeout))}>
            <FieldLabel htmlFor="mcp-timeout">Time limit per request (seconds)</FieldLabel>
            <Input
              id="mcp-timeout"
              type="number"
              min={1}
              inputMode="numeric"
              value={timeoutText}
              onChange={(event) => setTimeoutText(event.target.value)}
              placeholder="Default"
              className="w-40"
              aria-invalid={Boolean(show(errors.timeout))}
            />
            {show(errors.timeout) ? (
              <FieldError>{errors.timeout}</FieldError>
            ) : (
              <FieldDescription>Leave empty unless the server is slow to answer.</FieldDescription>
            )}
          </Field>
        </FieldGroup>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || (touched && !valid)}>
            {save.isPending && <Spinner />}
            {server ? "Save changes" : "Add server"}
          </Button>
        </div>
      </form>
    </div>
  );
}
