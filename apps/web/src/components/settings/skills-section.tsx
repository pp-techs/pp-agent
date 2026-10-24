import * as React from "react";
import type { DesktopBridge, SkillSummary } from "@workspace/shared";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item";
import { Kbd } from "@workspace/ui/components/kbd";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { Switch } from "@workspace/ui/components/switch";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import {
  DownloadIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { SectionHeading } from "@/components/settings/section-heading";
import { SkillEditor } from "@/components/settings/skill-editor";
import {
  skillsQuery,
  useDeleteSkill,
  useImportSkill,
  useSetSkillEnabled,
} from "@/lib/extension-queries";

type View = { kind: "list" } | { kind: "edit"; name?: string };

function SkillRow({
  bridge,
  skill,
  onEdit,
}: {
  bridge: DesktopBridge;
  skill: SkillSummary;
  onEdit: () => void;
}) {
  const { t } = useTranslation(["extensions", "common"]);
  const setEnabled = useSetSkillEnabled(bridge);
  const remove = useDeleteSkill(bridge);
  const enabled = setEnabled.isPending ? setEnabled.variables.enabled : skill.enabled;

  async function onDelete() {
    const confirmed = await ConfirmModal.show({
      title: t("skills.deleteConfirm.title"),
      description: t("skills.deleteConfirm.description", { name: skill.name }),
      confirmLabel: t("common:actions.delete"),
    });
    if (!confirmed) return;
    remove.mutate(skill.name, {
      onSuccess: () => toast.success(t("skills.toast.deleted", { name: skill.name })),
    });
  }

  return (
    <Item variant="outline" size="sm" className={enabled ? undefined : "opacity-70"}>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          <span className="font-mono">{skill.name}</span>
          {skill.builtIn && <Badge variant="outline">{t("skills.builtIn")}</Badge>}
          {!skill.modelInvocable && <Badge variant="secondary">{t("skills.onlyWhenAsked")}</Badge>}
        </ItemTitle>
        <ItemDescription className="line-clamp-2">{skill.description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        {remove.isPending && <Spinner />}
        <Switch
          checked={enabled}
          disabled={setEnabled.isPending || remove.isPending}
          onCheckedChange={(value) => setEnabled.mutate({ name: skill.name, enabled: value })}
          aria-label={
            enabled
              ? t("skills.row.turnOff", { name: skill.name })
              : t("skills.row.turnOn", { name: skill.name })
          }
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("skills.row.actionsFor", { name: skill.name })}
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon />
              {t("common:actions.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                bridge.files.reveal(skill.path).catch((error: Error) => toast.error(error.message))
              }
            >
              <FolderOpenIcon />
              {t("showInFolder")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void onDelete()}>
              <Trash2Icon />
              {t("common:actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );
}

export function SkillsSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation(["extensions", "common"]);
  const skills = useQuery(skillsQuery(bridge));
  const importSkill = useImportSkill(bridge);
  const [view, setView] = React.useState<View>({ kind: "list" });

  if (view.kind === "edit") {
    return (
      <SkillEditor bridge={bridge} name={view.name} onDone={() => setView({ kind: "list" })} />
    );
  }

  async function onImport() {
    let path: string | null;
    try {
      path = await bridge.files.pickSkill();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!path) return;
    importSkill.mutate(path, {
      onSuccess: (imported) => {
        const first = imported[0];
        if (!first) toast.info(t("skills.toast.none"));
        else if (imported.length === 1)
          toast.success(t("skills.toast.added", { name: first.name }));
        else toast.success(t("skills.toast.addedMany", { count: imported.length }));
      },
    });
  }

  const actions = (
    <>
      <Button variant="outline" disabled={importSkill.isPending} onClick={() => void onImport()}>
        {importSkill.isPending ? <Spinner /> : <DownloadIcon />}
        {t("common:actions.import")}
      </Button>
      <Button onClick={() => setView({ kind: "edit" })}>
        <PlusIcon />
        {t("skills.newSkill")}
      </Button>
    </>
  );

  const list = skills.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title={t("skills.heading.title")}
        description={t("skills.heading.description")}
      >
        {list.length > 0 && actions}
      </SectionHeading>

      {skills.isPending ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : skills.isError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("skills.loadError")}</AlertTitle>
          <AlertDescription>{skills.error.message}</AlertDescription>
        </Alert>
      ) : list.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyTitle>{t("skills.empty.title")}</EmptyTitle>
            <EmptyDescription>{t("skills.empty.description")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">{actions}</EmptyContent>
        </Empty>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <Trans
              t={t}
              i18nKey="skills.usageHint"
              values={{ example: list[0]?.name }}
              components={{ kbd: <Kbd className="font-mono" /> }}
            />
          </p>
          <ItemGroup>
            {list.map((skill) => (
              <SkillRow
                key={skill.name}
                bridge={bridge}
                skill={skill}
                onEdit={() => setView({ kind: "edit", name: skill.name })}
              />
            ))}
          </ItemGroup>
        </>
      )}
    </div>
  );
}
