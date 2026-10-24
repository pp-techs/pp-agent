import * as React from "react";
import {
  GATEWAY_APIS,
  type DesktopBridge,
  type GatewayApi,
  type FetchedGatewayModel,
  type GatewayModel,
  type GatewayView,
  type ProviderSummary,
} from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@workspace/ui/components/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workspace/ui/components/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { Toggle } from "@workspace/ui/components/toggle";
import { useQuery } from "@tanstack/react-query";
import {
  BrainIcon,
  DownloadIcon,
  ImageIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { OptionGroup, SubOptions, SwitchRow } from "@/components/settings/option-group";
import { SectionHeading } from "@/components/settings/section-heading";
import { modelLabel } from "@/lib/models";
import {
  gatewaysQuery,
  providersQuery,
  useProviderCommands,
  type ProviderCommands,
} from "@/lib/queries";

const API_LABEL_KEYS = {
  "openai-completions": "apiTypes.openaiCompletions",
  "openai-responses": "apiTypes.openaiResponses",
  "anthropic-messages": "apiTypes.anthropicMessages",
} as const satisfies Record<GatewayApi, string>;

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Closing the key prompt rejects `connect_provider` with "Cancelled"; that is not an error. */
const isCancelled = (error: Error) => /cancel/i.test(error.message);

function GroupHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase">{title}</h3>
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}

function ProviderRow({
  provider,
  commands,
  onEditGateway,
}: {
  provider: ProviderSummary;
  commands: ProviderCommands;
  onEditGateway: (id: string) => void;
}) {
  const { t } = useTranslation(["models", "common"]);
  const { connect, disconnect } = commands;

  /** The backend names the credential source in English ("Saved key", "Environment variable"). */
  function authSourceLabel(source: string | undefined) {
    if (source === "Saved key") return t("providerRow.authSource.savedKey");
    if (source === "Environment variable") return t("providerRow.authSource.environmentVariable");
    return source ?? t("providerRow.authSource.connected");
  }

  const connecting = connect.isPending && connect.variables === provider.id;
  const disconnecting = disconnect.isPending && disconnect.variables === provider.id;

  function onConnect() {
    connect.mutate(provider.id, {
      onSuccess: (result) => toast.success(t("providerRow.connectedToast", { name: result.name })),
      onError: (error) => {
        if (!isCancelled(error)) toast.error(error.message);
      },
    });
  }

  async function onDisconnect() {
    const confirmed = await ConfirmModal.show({
      title: t("providerRow.disconnectTitle", { name: provider.name }),
      description: t("providerRow.disconnectDescription"),
      confirmLabel: t("providerRow.disconnect"),
    });
    if (!confirmed) return;
    disconnect.mutate(provider.id, {
      onSuccess: () => toast.success(t("providerRow.disconnectedToast", { name: provider.name })),
      onError: (error) => toast.error(error.message),
    });
  }

  const details = provider.configured
    ? [authSourceLabel(provider.authSource), t("modelCount", { count: provider.modelCount })]
    : [t("modelCount", { count: provider.modelCount })];

  return (
    <Item variant="outline" size="xs">
      <ItemContent className="min-w-0">
        <ItemTitle>
          {provider.name}
          {provider.kind === "gateway" && (
            <Badge variant="secondary">{t("providerRow.gatewayBadge")}</Badge>
          )}
        </ItemTitle>
        <ItemDescription className="line-clamp-1 text-xs">{details.join(" · ")}</ItemDescription>
      </ItemContent>
      <ItemActions>
        {provider.kind === "gateway" ? (
          <Button variant="outline" size="sm" onClick={() => onEditGateway(provider.id)}>
            <PencilIcon data-icon="inline-start" />
            {t("common:actions.edit")}
          </Button>
        ) : provider.configured ? (
          <>
            <Button variant="ghost" size="sm" disabled={connect.isPending} onClick={onConnect}>
              {connecting && <Spinner data-icon="inline-start" />}
              {t("providerRow.changeKey")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disconnecting}
              onClick={() => void onDisconnect()}
            >
              {disconnecting && <Spinner data-icon="inline-start" />}
              {t("providerRow.disconnect")}
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={connect.isPending} onClick={onConnect}>
            {connecting && <Spinner data-icon="inline-start" />}
            {t("providerRow.connect")}
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

/** 128000 → "128k", 1000000 → "1M": how model cards print a context window. */
function formatTokens(value: number) {
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function ModelRow({
  model,
  onChange,
  onRemove,
}: {
  model: GatewayModel;
  onChange: (model: GatewayModel) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("models");
  return (
    <div className="flex items-center gap-1 rounded-xl px-2 py-1 hover:bg-muted/50">
      <div className="flex min-w-0 flex-1 flex-col">
        <Input
          aria-label={t("modelRow.displayName.label", { id: model.id })}
          title={t("modelRow.displayName.hint")}
          placeholder={modelLabel({ name: "", modelId: model.id })}
          className="h-7 border-transparent bg-transparent px-1.5 text-sm shadow-none hover:border-input focus-visible:border-ring"
          value={model.name ?? ""}
          onChange={(event) => {
            const { name: _old, ...rest } = model;
            onChange(event.target.value.trim() ? { ...rest, name: event.target.value } : rest);
          }}
        />
        <span
          className="truncate px-1.5 font-mono text-[11px] text-muted-foreground"
          title={model.id}
        >
          {model.id}
        </span>
      </div>
      <Input
        type="number"
        min={1000}
        step={1000}
        inputMode="numeric"
        aria-label={t("modelRow.contextWindow.label", { id: model.id })}
        title={t("modelRow.contextWindow.hint")}
        placeholder={t("modelRow.contextWindow.placeholder")}
        className="h-7 w-24 text-xs tabular-nums"
        value={model.contextWindow ?? ""}
        onChange={(event) => {
          const value = Math.round(Number(event.target.value));
          const { contextWindow: _old, ...rest } = model;
          onChange(value > 0 ? { ...rest, contextWindow: value } : rest);
        }}
      />
      <Toggle
        size="sm"
        aria-label={t("modelRow.images")}
        title={t("modelRow.images")}
        pressed={model.images ?? true}
        onPressedChange={(images) => onChange({ ...model, images })}
      >
        <ImageIcon />
      </Toggle>
      <Toggle
        size="sm"
        aria-label={t("modelRow.reasoning.label")}
        title={t("modelRow.reasoning.hint")}
        pressed={model.reasoning ?? false}
        onPressedChange={(reasoning) => onChange({ ...model, reasoning })}
      >
        <BrainIcon />
      </Toggle>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("modelRow.remove", { id: model.id })}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </div>
  );
}

/** Models the gateway listed, as a searchable checklist; ticked ones are added to the gateway. */
function FetchedModels({
  models,
  included,
  onInclude,
}: {
  models: FetchedGatewayModel[];
  included: Set<string>;
  onInclude: (models: FetchedGatewayModel[], include: boolean) => void;
}) {
  const { t } = useTranslation("models");
  const [search, setSearch] = React.useState("");
  const query = search.trim().toLowerCase();
  const visible = query
    ? models.filter((model) =>
        [
          model.id,
          model.name ?? "",
          modelLabel({ name: model.name ?? "", modelId: model.id }),
        ].some((text) => text.toLowerCase().includes(query)),
      )
    : models;
  const selectedCount = models.filter((model) => included.has(model.id)).length;
  const visibleSelected = visible.filter((model) => included.has(model.id)).length;

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {query
            ? t("fetchedModels.selectedCountShown", {
                selected: selectedCount,
                total: models.length,
                shown: visible.length,
              })
            : t("fetchedModels.selectedCount", { selected: selectedCount, total: models.length })}
        </span>
        <div className="ml-auto flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={visibleSelected === visible.length}
            onClick={() => onInclude(visible, true)}
          >
            {query ? t("fetchedModels.selectAllShown") : t("fetchedModels.selectAll")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={visibleSelected === 0}
            onClick={() => onInclude(visible, false)}
          >
            {query ? t("fetchedModels.clearShown") : t("fetchedModels.clear")}
          </Button>
        </div>
      </div>
      <InputGroup>
        <InputGroupInput
          aria-label={t("fetchedModels.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("fetchedModels.search")}
          autoComplete="off"
        />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>
      {visible.length === 0 ? (
        <p className="px-2 py-1 text-sm text-muted-foreground">{t("fetchedModels.noMatch")}</p>
      ) : (
        <div className="flex max-h-60 flex-col overflow-y-auto">
          {visible.map((model) => (
            <label
              key={model.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-muted/50"
            >
              <Checkbox
                checked={included.has(model.id)}
                onCheckedChange={(checked) => onInclude([model], checked)}
              />
              <span className="flex min-w-0 flex-1 flex-col" title={model.id}>
                <span className="truncate text-sm">
                  {model.name ?? modelLabel({ name: "", modelId: model.id })}
                </span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {model.id}
                </span>
              </span>
              {model.contextWindow && (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatTokens(model.contextWindow)}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function GatewayForm({
  gateway,
  commands,
  onDone,
}: {
  /** Gateway being edited; undefined when adding one. */
  gateway: GatewayView | undefined;
  commands: ProviderCommands;
  onDone: () => void;
}) {
  const { t } = useTranslation(["models", "common"]);
  const apiItems = GATEWAY_APIS.map((value) => ({ value, label: t(API_LABEL_KEYS[value]) }));
  const { saveGateway, fetchGatewayModels } = commands;
  const [name, setName] = React.useState(gateway?.name ?? "");
  const [api, setApi] = React.useState<GatewayApi>(gateway?.api ?? "openai-completions");
  const [baseUrl, setBaseUrl] = React.useState(gateway?.baseUrl ?? "");
  const [apiKey, setApiKey] = React.useState("");
  const [requiresApiKey, setRequiresApiKey] = React.useState(gateway?.requiresApiKey ?? true);
  const [models, setModels] = React.useState<GatewayModel[]>(gateway?.models ?? []);
  const [manualId, setManualId] = React.useState("");
  const [fetched, setFetched] = React.useState<FetchedGatewayModel[] | null>(null);

  const url = baseUrl.trim();
  const urlInvalid = url !== "" && !isHttpUrl(url);
  const hasKey = apiKey.trim() !== "" || Boolean(gateway?.hasApiKey) || !requiresApiKey;
  const canSave = name.trim() !== "" && isHttpUrl(url) && models.length > 0;
  const included = new Set(models.map((model) => model.id));
  // Names the person typed, or the tidied ids, that more than one model of this gateway shows.
  const duplicateNames = (() => {
    const seen = new Map<string, number>();
    for (const model of models) {
      const shown = model.name?.trim() || modelLabel({ name: "", modelId: model.id });
      seen.set(shown, (seen.get(shown) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, count]) => count > 1).map(([shown]) => shown));
  })();

  function addModel(id: string) {
    const trimmed = id.trim();
    if (!trimmed || included.has(trimmed)) return;
    setModels((list) => [...list, { id: trimmed }]);
  }

  /** Adds or removes several fetched models at once, keeping the settings of those kept. */
  function includeModels(picked: FetchedGatewayModel[], include: boolean) {
    setModels((list) => {
      if (!include) {
        const drop = new Set(picked.map((model) => model.id));
        return list.filter((model) => !drop.has(model.id));
      }
      const present = new Set(list.map((model) => model.id));
      return [...list, ...picked.filter((model) => !present.has(model.id))];
    });
  }

  function onFetch() {
    fetchGatewayModels.mutate(
      { api, baseUrl: url, apiKey: apiKey.trim() || undefined, gatewayId: gateway?.id },
      {
        onSuccess: (found) => {
          setFetched(found);
          // Models already added get the limits the gateway reports, unless the person set them.
          setModels((list) =>
            list.map((model) => {
              const reported = found.find((item) => item.id === model.id);
              return reported
                ? {
                    ...model,
                    name: model.name ?? reported.name,
                    contextWindow: model.contextWindow ?? reported.contextWindow,
                    maxTokens: model.maxTokens ?? reported.maxTokens,
                  }
                : model;
            }),
          );
          if (found.length === 0) toast.info(t("gatewayForm.noModelsListed"));
        },
      },
    );
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    saveGateway.mutate(
      {
        id: gateway?.id,
        name: name.trim(),
        api,
        baseUrl: url,
        requiresApiKey,
        models,
        apiKey: apiKey.trim() || undefined,
      },
      {
        onSuccess: (saved) => {
          toast.success(t("gatewayForm.saved", { name: saved.name }));
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 rounded-2xl border p-4">
      <h4 className="font-medium">
        {gateway ? t("gatewayForm.titleEdit", { name: gateway.name }) : t("gatewayForm.titleAdd")}
      </h4>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="gateway-name">{t("gatewayForm.name.label")}</FieldLabel>
          <Input
            id="gateway-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("gatewayForm.name.placeholder")}
            autoComplete="off"
            autoFocus
          />
          <FieldDescription>{t("gatewayForm.name.description")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>{t("gatewayForm.apiType.label")}</FieldLabel>
          <Select items={apiItems} value={api} onValueChange={(value) => value && setApi(value)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {apiItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t("gatewayForm.apiType.description")}</FieldDescription>
        </Field>
        <Field data-invalid={urlInvalid || undefined}>
          <FieldLabel htmlFor="gateway-url">{t("gatewayForm.url.label")}</FieldLabel>
          <Input
            id="gateway-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://gateway.example.com/v1"
            aria-invalid={urlInvalid || undefined}
            autoComplete="off"
          />
          {urlInvalid ? (
            <FieldError>{t("gatewayForm.url.invalid")}</FieldError>
          ) : (
            <FieldDescription>{t("gatewayForm.url.description")}</FieldDescription>
          )}
        </Field>
        <SwitchRow
          id="gateway-requires-key"
          label={t("gatewayForm.requiresKey.label")}
          description={t("gatewayForm.requiresKey.description")}
          checked={requiresApiKey}
          onCheckedChange={setRequiresApiKey}
        />
        <Field>
          <FieldLabel htmlFor="gateway-key">
            {requiresApiKey ? t("gatewayForm.apiKey.label") : t("gatewayForm.apiKey.labelOptional")}
          </FieldLabel>
          <Input
            id="gateway-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              gateway?.hasApiKey
                ? t("gatewayForm.apiKey.placeholderSaved")
                : t("gatewayForm.apiKey.placeholderNew")
            }
            autoComplete="off"
          />
          <FieldDescription>
            {requiresApiKey
              ? t("gatewayForm.apiKey.description")
              : t("gatewayForm.apiKey.descriptionOptional")}
          </FieldDescription>
        </Field>
        <OptionGroup
          legend={t("gatewayForm.models.legend")}
          description={t("gatewayForm.models.description")}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isHttpUrl(url) || !hasKey || fetchGatewayModels.isPending}
              onClick={onFetch}
            >
              {fetchGatewayModels.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <DownloadIcon data-icon="inline-start" />
              )}
              {t("gatewayForm.models.load")}
            </Button>
          }
        >
          {fetchGatewayModels.isError && (
            <FieldError>
              {t("gatewayForm.models.loadError", { message: fetchGatewayModels.error.message })}
            </FieldError>
          )}
          {fetched && fetched.length > 0 && (
            <FetchedModels models={fetched} included={included} onInclude={includeModels} />
          )}
          <InputGroup>
            <InputGroupInput
              aria-label={t("gatewayForm.models.manualLabel")}
              value={manualId}
              onChange={(event) => setManualId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addModel(manualId);
                setManualId("");
              }}
              placeholder={t("gatewayForm.models.manualPlaceholder")}
              autoComplete="off"
            />
            <InputGroupAddon align="inline-end">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={!manualId.trim()}
                onClick={() => {
                  addModel(manualId);
                  setManualId("");
                }}
              >
                <PlusIcon data-icon="inline-start" />
                {t("common:actions.add")}
              </Button>
            </InputGroupAddon>
          </InputGroup>
          {models.length === 0 ? (
            <FieldDescription className="text-xs">
              {t("gatewayForm.models.atLeastOne")}
            </FieldDescription>
          ) : (
            <SubOptions>
              {duplicateNames.size > 0 && (
                <FieldDescription className="text-xs">
                  {t("gatewayForm.models.duplicateNames", {
                    names: [...duplicateNames].map((n) => `“${n}”`).join(", "),
                  })}
                </FieldDescription>
              )}
              <div className="flex flex-col">
                {models.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    onChange={(next) =>
                      setModels((list) => list.map((item) => (item.id === model.id ? next : item)))
                    }
                    onRemove={() =>
                      setModels((list) => list.filter((item) => item.id !== model.id))
                    }
                  />
                ))}
              </div>
            </SubOptions>
          )}
        </OptionGroup>
      </FieldGroup>
      {saveGateway.isError && <FieldError>{saveGateway.error.message}</FieldError>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" disabled={!canSave || saveGateway.isPending}>
          {saveGateway.isPending && <Spinner data-icon="inline-start" />}
          {t("common:actions.save")}
        </Button>
      </div>
    </form>
  );
}

function GatewayRow({
  gateway,
  commands,
  onEdit,
}: {
  gateway: GatewayView;
  commands: ProviderCommands;
  onEdit: () => void;
}) {
  const { t } = useTranslation(["models", "common"]);
  const { deleteGateway } = commands;
  const deleting = deleteGateway.isPending && deleteGateway.variables === gateway.id;

  async function onDelete() {
    const confirmed = await ConfirmModal.show({
      title: t("gatewayRow.deleteTitle", { name: gateway.name }),
      description: t("gatewayRow.deleteDescription"),
      confirmLabel: t("common:actions.delete"),
    });
    if (!confirmed) return;
    deleteGateway.mutate(gateway.id, {
      onSuccess: () => toast.success(t("gatewayRow.deleted", { name: gateway.name })),
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <Item variant="outline" size="xs">
      <ItemContent className="min-w-0">
        <ItemTitle>{gateway.name}</ItemTitle>
        <ItemDescription className="line-clamp-1 text-xs">
          {[
            gateway.baseUrl,
            t("modelCount", { count: gateway.models.length }),
            gateway.hasApiKey
              ? t("gatewayRow.keySaved")
              : gateway.requiresApiKey
                ? t("gatewayRow.needsKey")
                : t("gatewayRow.noKeyNeeded"),
          ].join(" · ")}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <PencilIcon data-icon="inline-start" />
          {t("common:actions.edit")}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("gatewayRow.delete", { name: gateway.name })}
          disabled={deleting}
          onClick={() => void onDelete()}
        >
          {deleting ? <Spinner /> : <Trash2Icon />}
        </Button>
      </ItemActions>
    </Item>
  );
}

export function ModelsSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("models");
  const providers = useQuery(providersQuery(bridge));
  const gateways = useQuery(gatewaysQuery(bridge));
  const commands = useProviderCommands(bridge);
  const [search, setSearch] = React.useState("");
  /** Gateway id being edited, "new" while adding, null when the form is closed. */
  const [editing, setEditing] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLDivElement>(null);

  function editGateway(id: string) {
    setEditing(id);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  if (providers.isPending || gateways.isPending) return <Spinner />;
  if (providers.isError) return <FieldError>{providers.error.message}</FieldError>;

  const all = providers.data;
  const connected = all.filter((provider) => provider.configured);
  const query = search.trim().toLowerCase();
  const available = all.filter(
    (provider) =>
      !provider.configured &&
      (query === "" ||
        provider.name.toLowerCase().includes(query) ||
        provider.id.toLowerCase().includes(query)),
  );
  const gatewayList = gateways.data ?? [];
  const editedGateway = gatewayList.find((gateway) => gateway.id === editing);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title={t("section.title")} description={t("section.description")} />

      <section className="flex flex-col gap-2">
        <GroupHeading title={t("section.connected.heading")} />
        {connected.length === 0 ? (
          <Empty className="border border-dashed p-6">
            <EmptyHeader>
              <EmptyTitle>{t("section.connected.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("section.connected.emptyDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {connected.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                commands={commands}
                onEditGateway={editGateway}
              />
            ))}
          </ItemGroup>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <GroupHeading title={t("section.gateways.heading")}>
          <Button variant="outline" size="sm" onClick={() => editGateway("new")}>
            <PlusIcon data-icon="inline-start" />
            {t("section.gateways.add")}
          </Button>
        </GroupHeading>
        <div ref={formRef}>
          {editing !== null && (
            <GatewayForm
              key={editing}
              gateway={editedGateway}
              commands={commands}
              onDone={() => setEditing(null)}
            />
          )}
        </div>
        {gatewayList.length === 0 && editing === null ? (
          <p className="text-sm text-muted-foreground">{t("section.gateways.hint")}</p>
        ) : (
          <ItemGroup>
            {gatewayList
              .filter((gateway) => gateway.id !== editing)
              .map((gateway) => (
                <GatewayRow
                  key={gateway.id}
                  gateway={gateway}
                  commands={commands}
                  onEdit={() => editGateway(gateway.id)}
                />
              ))}
          </ItemGroup>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <GroupHeading title={t("section.available.heading")} />
        <InputGroup>
          <InputGroupInput
            aria-label={t("section.available.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("section.available.search")}
          />
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
        </InputGroup>
        {available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {query ? t("section.available.noMatch") : t("section.available.allConnected")}
          </p>
        ) : (
          <ItemGroup>
            {available.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                commands={commands}
                onEditGateway={editGateway}
              />
            ))}
          </ItemGroup>
        )}
      </section>
    </div>
  );
}
