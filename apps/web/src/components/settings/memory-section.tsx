import * as React from "react";
import { type DesktopBridge, MEMORY_LIMITS, type MemoryEntry } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Field, FieldError, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { Textarea } from "@workspace/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { BrainIcon, PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { OptionGroup, SwitchRow } from "@/components/settings/option-group";
import { SectionHeading } from "@/components/settings/section-heading";
import { memoryQuery, useMemoryCommands } from "@/lib/extension-queries";

/** A note being added (`id` omitted) or edited. */
type Draft = { id?: string; text: string; tag: string };

function NoteForm({
  bridge,
  draft,
  onDone,
}: {
  bridge: DesktopBridge;
  draft: Draft;
  onDone: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const { save } = useMemoryCommands(bridge);
  const [text, setText] = React.useState(draft.text);
  const [tag, setTag] = React.useState(draft.tag);
  const [touched, setTouched] = React.useState(false);
  const trimmed = text.trim();
  const error = !trimmed
    ? t("memory.errors.textRequired")
    : trimmed.length > MEMORY_LIMITS.maxEntryLength
      ? t("memory.errors.textTooLong", { max: MEMORY_LIMITS.maxEntryLength })
      : null;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (error) return;
    save.mutate({ id: draft.id, text: trimmed, tag: tag.trim() || null }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border p-4">
      <FieldGroup>
        <Field data-invalid={touched && Boolean(error)}>
          <FieldLabel htmlFor="memory-text">{t("memory.form.text")}</FieldLabel>
          <Textarea
            id="memory-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("memory.form.textPlaceholder")}
            aria-invalid={touched && Boolean(error)}
            className="min-h-20 resize-y"
            autoFocus
          />
          {touched && error && <FieldError>{error}</FieldError>}
        </Field>
        <Field>
          <FieldLabel htmlFor="memory-tag">{t("memory.form.tag")}</FieldLabel>
          <Input
            id="memory-tag"
            value={tag}
            maxLength={MEMORY_LIMITS.maxTagLength}
            onChange={(event) => setTag(event.target.value)}
            placeholder={t("memory.form.tagPlaceholder")}
          />
        </Field>
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending || (touched && Boolean(error))}>
          {save.isPending && <Spinner />}
          {t("common:actions.save")}
        </Button>
      </div>
    </form>
  );
}

function NoteRow({
  bridge,
  entry,
  onEdit,
}: {
  bridge: DesktopBridge;
  entry: MemoryEntry;
  onEdit: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const { remove } = useMemoryCommands(bridge);

  async function onDelete() {
    const confirmed = await ConfirmModal.show({
      title: t("memory.deleteConfirm.title"),
      description: t("memory.deleteConfirm.description", { text: entry.text }),
      confirmLabel: t("common:actions.delete"),
    });
    if (!confirmed) return;
    remove.mutate(entry.id, { onSuccess: () => toast.success(t("memory.deleted")) });
  }

  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap whitespace-pre-wrap">
          {entry.text}
          {entry.tag && <Badge variant="secondary">{entry.tag}</Badge>}
        </ItemTitle>
        <ItemDescription className="text-xs">
          {new Date(entry.updatedAt).toLocaleString()}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {remove.isPending && <Spinner />}
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t("memory.editLabel")}
          onClick={onEdit}
        >
          <PencilIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("memory.deleteLabel")}
          disabled={remove.isPending}
          onClick={() => void onDelete()}
        >
          <Trash2Icon />
        </Button>
      </ItemActions>
    </Item>
  );
}

export function MemorySection({ bridge }: { bridge: DesktopBridge }) {
  const memory = useQuery(memoryQuery(bridge));
  const { setEnabled, clear } = useMemoryCommands(bridge);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const { t } = useTranslation(["settings", "common"]);

  async function onClear() {
    const confirmed = await ConfirmModal.show({
      title: t("memory.clearConfirm.title"),
      description: t("memory.clearConfirm.description"),
      confirmLabel: t("memory.clearConfirm.confirm"),
    });
    if (!confirmed) return;
    clear.mutate(undefined, { onSuccess: () => toast.success(t("memory.cleared")) });
  }

  const entries = memory.data?.entries ?? [];
  const full = entries.length >= MEMORY_LIMITS.maxEntries;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title={t("memory.title")} description={t("memory.description")}>
        {entries.length > 0 && (
          <Button variant="outline" disabled={clear.isPending} onClick={() => void onClear()}>
            {clear.isPending ? <Spinner /> : <Trash2Icon data-icon="inline-start" />}
            {t("memory.clearAll")}
          </Button>
        )}
        <Button
          disabled={!memory.data || full || draft !== null}
          onClick={() => setDraft({ text: "", tag: "" })}
        >
          <PlusIcon />
          {t("memory.add")}
        </Button>
      </SectionHeading>

      <OptionGroup legend={t("memory.enable.legend")}>
        <SwitchRow
          id="memory-enabled"
          label={t("memory.enable.label")}
          description={t("memory.enable.description")}
          checked={memory.data?.enabled ?? true}
          disabled={!memory.data || setEnabled.isPending}
          onCheckedChange={(enabled) => setEnabled.mutate(enabled)}
        />
      </OptionGroup>

      {draft && (
        <NoteForm
          key={draft.id ?? "new"}
          bridge={bridge}
          draft={draft}
          onDone={() => setDraft(null)}
        />
      )}

      {memory.isPending ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : memory.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("memory.loadError")}</AlertTitle>
          <AlertDescription>{memory.error.message}</AlertDescription>
        </Alert>
      ) : entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BrainIcon />
            </EmptyMedia>
            <EmptyTitle>{t("memory.empty.title")}</EmptyTitle>
            <EmptyDescription>{t("memory.empty.description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ItemGroup>
            {entries.map((entry) => (
              <NoteRow
                key={entry.id}
                bridge={bridge}
                entry={entry}
                onEdit={() => setDraft({ id: entry.id, text: entry.text, tag: entry.tag ?? "" })}
              />
            ))}
          </ItemGroup>
          <p className="text-xs text-muted-foreground">
            {t("memory.count", { count: entries.length, max: MEMORY_LIMITS.maxEntries })}
          </p>
        </>
      )}
    </div>
  );
}
