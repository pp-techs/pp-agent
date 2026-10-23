import * as React from "react";
import type {
  DesktopBridge,
  SearchProviderId,
  SearchProviderView,
  WebSearchTestResult,
  WebSearchView,
} from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@workspace/ui/components/item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Switch } from "@workspace/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { OptionGroup } from "@/components/settings/option-group";
import { useSaveWebSearch, useTestWebSearch, webSearchQuery } from "@/lib/extension-queries";

interface Draft {
  /** Enabled providers, in the order they are tried. */
  enabled: SearchProviderId[];
  endpoints: Record<string, string>;
  /** New key typed for a provider; `null` removes the saved one. */
  keys: Partial<Record<SearchProviderId, string | null>>;
}

function initialDraft(view: WebSearchView): Draft {
  return {
    enabled: view.providers.filter((provider) => provider.enabled).map((provider) => provider.id),
    endpoints: Object.fromEntries(
      view.providers.map((provider) => [provider.id, provider.endpoint]),
    ),
    keys: {},
  };
}

function isDirty(view: WebSearchView, draft: Draft) {
  const saved = initialDraft(view);
  return (
    saved.enabled.join() !== draft.enabled.join() ||
    Object.keys(draft.keys).length > 0 ||
    view.providers.some(
      (provider) => (draft.endpoints[provider.id] ?? "").trim() !== provider.endpoint,
    )
  );
}

function ProviderRow({
  provider,
  draft,
  position,
  lastPosition,
  canTest,
  onChange,
  onMove,
  bridge,
}: {
  provider: SearchProviderView;
  draft: Draft;
  position: number;
  lastPosition: number;
  canTest: boolean;
  onChange: (change: (draft: Draft) => Draft) => void;
  onMove: (direction: -1 | 1) => void;
  bridge: DesktopBridge;
}) {
  const test = useTestWebSearch(bridge);
  const [result, setResult] = React.useState<WebSearchTestResult | null>(null);
  const enabled = position !== -1;
  const pendingKey = draft.keys[provider.id];
  const hasKey = pendingKey === undefined ? provider.hasKey : pendingKey !== null;
  const ready =
    (!provider.keyRequired || hasKey) &&
    (!provider.endpointRequired || (draft.endpoints[provider.id] ?? "").trim() !== "");

  return (
    <Item variant="outline" size="sm" className="flex-col items-stretch gap-3">
      <div className="flex items-center gap-3">
        <ItemContent className="min-w-0">
          <ItemTitle>
            {provider.label}
            {enabled && <Badge variant="secondary">#{position + 1}</Badge>}
            {enabled && !ready && <Badge variant="destructive">Needs setup</Badge>}
          </ItemTitle>
        </ItemContent>
        {enabled && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Try ${provider.label} earlier`}
              disabled={position === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Try ${provider.label} later`}
              disabled={position === lastPosition}
              onClick={() => onMove(1)}
            >
              <ArrowDownIcon />
            </Button>
          </>
        )}
        <Switch
          size="sm"
          aria-label={`Use ${provider.label}`}
          checked={enabled}
          onCheckedChange={(checked) =>
            onChange((current) => ({
              ...current,
              enabled: checked
                ? [...current.enabled, provider.id]
                : current.enabled.filter((id) => id !== provider.id),
            }))
          }
        />
      </div>
      {(provider.usesKey || provider.usesEndpoint) && (
        <div className="flex flex-col gap-2">
          {provider.usesEndpoint && (
            <Input
              value={draft.endpoints[provider.id] ?? ""}
              placeholder={
                provider.id === "searxng"
                  ? "Server address, e.g. https://search.example.com"
                  : "Server address (leave empty for webclaw cloud)"
              }
              aria-label={`${provider.label} server address`}
              onChange={(event) => {
                const value = event.target.value;
                onChange((current) => ({
                  ...current,
                  endpoints: { ...current.endpoints, [provider.id]: value },
                }));
              }}
            />
          )}
          {provider.usesKey && (
            <div className="flex items-center gap-2">
              <Input
                type="password"
                autoComplete="off"
                value={typeof pendingKey === "string" ? pendingKey : ""}
                placeholder={
                  hasKey
                    ? "Key saved. Type to replace it."
                    : provider.keyRequired
                      ? "API key"
                      : "Access token (optional)"
                }
                aria-label={`${provider.label} API key`}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange((current) => {
                    const { [provider.id]: _removed, ...keys } = current.keys;
                    return { ...current, keys: value ? { ...keys, [provider.id]: value } : keys };
                  });
                }}
              />
              {hasKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onChange((current) => ({
                      ...current,
                      keys: { ...current.keys, [provider.id]: null },
                    }))
                  }
                >
                  Remove key
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Button
          variant="outline"
          size="xs"
          disabled={!canTest || test.isPending}
          onClick={() => test.mutate(provider.id, { onSuccess: setResult })}
        >
          {test.isPending ? "Testing…" : "Test"}
        </Button>
        {result && (
          <span className={result.ok ? "text-foreground" : "text-destructive"}>
            {result.message}
          </span>
        )}
        {!result && !canTest && <span>Save your changes to test.</span>}
      </div>
    </Item>
  );
}

function WebSearchForm({ bridge, view }: { bridge: DesktopBridge; view: WebSearchView }) {
  const save = useSaveWebSearch(bridge);
  const [draft, setDraft] = React.useState(() => initialDraft(view));
  const [saves, setSaves] = React.useState(0);
  const dirty = isDirty(view, draft);

  // Enabled providers first, in the draft's order, then the rest as the service lists them.
  const rows = [
    ...draft.enabled.flatMap((id) => view.providers.filter((provider) => provider.id === id)),
    ...view.providers.filter((provider) => !draft.enabled.includes(provider.id)),
  ];

  function move(id: SearchProviderId, direction: -1 | 1) {
    setDraft((current) => {
      const index = current.enabled.indexOf(id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= current.enabled.length) return current;
      const enabled = [...current.enabled];
      [enabled[index], enabled[target]] = [enabled[target]!, enabled[index]!];
      return { ...current, enabled };
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <ItemGroup className="gap-2">
        {rows.map((provider) => (
          <ProviderRow
            key={`${provider.id}-${saves}`}
            bridge={bridge}
            provider={provider}
            draft={draft}
            position={draft.enabled.indexOf(provider.id)}
            lastPosition={draft.enabled.length - 1}
            canTest={!dirty}
            onChange={(change) => setDraft(change)}
            onMove={(direction) => move(provider.id, direction)}
          />
        ))}
      </ItemGroup>
      <div className="flex justify-end">
        <Button
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate(
              { providers: draft.enabled, endpoints: draft.endpoints, keys: draft.keys },
              {
                // The saved view never holds key values, so it can equal the old one: reset the
                // form (and the rows' test results) from it explicitly.
                onSuccess: (saved) => {
                  setDraft(initialDraft(saved));
                  setSaves((count) => count + 1);
                },
              },
            )
          }
        >
          {save.isPending ? "Saving…" : "Save web search"}
        </Button>
      </div>
    </div>
  );
}

export function WebSearchGroup({ bridge }: { bridge: DesktopBridge }) {
  const query = useQuery(webSearchQuery(bridge));
  return (
    <OptionGroup
      legend="Web search"
      description="Pick the search services the agent can use. It tries them in order and moves on to the next when one fails. Keys stay encrypted on this computer."
    >
      {query.isPending ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : query.isError ? (
        <p className="text-sm text-destructive">{query.error.message}</p>
      ) : (
        // A saved change brings a new view; remounting resets the form to it.
        <WebSearchForm key={JSON.stringify(query.data)} bridge={bridge} view={query.data} />
      )}
    </OptionGroup>
  );
}
