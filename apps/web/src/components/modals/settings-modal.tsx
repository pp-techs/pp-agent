import * as React from "react";
import { createModal } from "@buiducnhat/better-modal";
import { PROVIDER_APIS, type DesktopBridge, type ProviderApi } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
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
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { modelsQuery, settingsQuery, useSaveSettings } from "@/lib/queries";

const API_LABELS: Record<ProviderApi, string> = {
  "openai-completions": "OpenAI-compatible (Chat Completions)",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
};
const API_ITEMS = PROVIDER_APIS.map((value) => ({ value, label: API_LABELS[value] }));

type SettingsModalProps = { bridge: DesktopBridge };

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function SettingsForm({
  bridge,
  onDone,
}: {
  bridge: DesktopBridge;
  onDone: (saved: boolean) => void;
}) {
  const settings = useQuery(settingsQuery(bridge));
  const current = settings.data;
  const [api, setApi] = React.useState<ProviderApi>(current?.api ?? "openai-completions");
  const [baseUrl, setBaseUrl] = React.useState(current?.baseUrl ?? "");
  const [apiKey, setApiKey] = React.useState("");
  const [modelId, setModelId] = React.useState(current?.modelId ?? "");
  const save = useSaveSettings(bridge);

  const lookupUrl = useDebouncedValue(baseUrl.trim(), 400);
  const lookupKey = useDebouncedValue(apiKey.trim(), 400);
  const models = useQuery({
    ...modelsQuery(bridge, lookupUrl, lookupKey),
    enabled: isHttpUrl(lookupUrl) && (lookupKey !== "" || Boolean(current?.hasApiKey)),
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(
      { api, baseUrl, modelId, apiKey: apiKey || undefined },
      {
        onSuccess: () => {
          toast.success("Settings saved");
          onDone(true);
        },
      },
    );
  }

  const canSave =
    isHttpUrl(baseUrl.trim()) &&
    modelId.trim() !== "" &&
    (apiKey !== "" || Boolean(current?.hasApiKey));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="gateway-url">Gateway URL</FieldLabel>
          <Input
            id="gateway-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://gateway.example.com/v1"
            autoComplete="off"
          />
          <FieldDescription>
            Your team's AI gateway. Ask your tech team if you don't know it.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="api-key">API key</FieldLabel>
          <Input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={current?.hasApiKey ? "Saved. Leave blank to keep it." : "Paste your key"}
            autoComplete="off"
          />
          <FieldDescription>Stored encrypted in your system keychain.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>API format</FieldLabel>
          <Select items={API_ITEMS} value={api} onValueChange={(value) => value && setApi(value)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {API_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="model-id">Model</FieldLabel>
          <Input
            id="model-id"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            placeholder="Type or pick a model"
            list="gateway-models"
            autoComplete="off"
          />
          <datalist id="gateway-models">
            {models.data?.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
          {models.isFetching ? (
            <FieldDescription className="flex items-center gap-2">
              <Spinner /> Loading models…
            </FieldDescription>
          ) : models.isError ? (
            <FieldError>Couldn't load models: {models.error.message}</FieldError>
          ) : models.data ? (
            <FieldDescription>{models.data.length} models available.</FieldDescription>
          ) : null}
        </Field>
      </FieldGroup>
      {save.isError && <FieldError>{save.error.message}</FieldError>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave || save.isPending}>
          {save.isPending && <Spinner />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

export const SettingsModal = createModal<SettingsModalProps, boolean>(
  "settings",
  ({ modal, bridge }) => {
    const settings = useQuery(settingsQuery(bridge));
    return (
      <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.resolve(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Model settings</DialogTitle>
            <DialogDescription>Connect PP Agent to the AI model your team uses.</DialogDescription>
          </DialogHeader>
          {settings.isPending ? (
            <Spinner />
          ) : (
            // Mounted once settings load, and again on every open, so it starts from saved values.
            <SettingsForm
              key={String(modal.visible)}
              bridge={bridge}
              onDone={(saved) => modal.resolve(saved)}
            />
          )}
        </DialogContent>
      </Dialog>
    );
  },
);
