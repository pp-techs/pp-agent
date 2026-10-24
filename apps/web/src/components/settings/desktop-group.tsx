import * as React from "react";
import { isValidAccelerator, type DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { OptionGroup, SwitchRow } from "@/components/settings/option-group";
import { settingsQuery, useUpdateSettings } from "@/lib/queries";

/** Notifications, tray icon, and the global shortcut: how the app behaves next to other windows. */
export function DesktopGroup({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const settings = useQuery(settingsQuery(bridge));
  const update = useUpdateSettings(bridge);
  const [draft, setDraft] = React.useState<string | null>(null);

  if (settings.isPending || !settings.data) return <Spinner />;
  const current = settings.data;
  const shortcut = draft ?? current.shortcut;
  const valid = isValidAccelerator(shortcut);

  const save = (patch: Parameters<typeof update.mutate>[0]) =>
    update.mutate(patch, { onError: (error) => toast.error(error.message) });

  return (
    <OptionGroup
      legend={t("general.desktop.legend")}
      description={t("general.desktop.description")}
    >
      <SwitchRow
        id="desktop-notifications"
        label={t("general.desktop.notifications.label")}
        description={t("general.desktop.notifications.description")}
        checked={current.notifications}
        disabled={update.isPending}
        onCheckedChange={(notifications) => save({ notifications })}
      />
      <SwitchRow
        id="desktop-tray"
        label={t("general.desktop.tray.label")}
        description={t("general.desktop.tray.description")}
        checked={current.tray}
        disabled={update.isPending}
        onCheckedChange={(tray) => save({ tray })}
      />
      <SwitchRow
        id="desktop-shortcut"
        label={t("general.desktop.shortcut.label")}
        description={t("general.desktop.shortcut.description")}
        checked={current.shortcutEnabled}
        disabled={update.isPending}
        onCheckedChange={(shortcutEnabled) => save({ shortcutEnabled })}
      />
      {current.shortcutEnabled && (
        <Field>
          <FieldLabel htmlFor="desktop-shortcut-keys">
            {t("general.desktop.shortcut.keys")}
          </FieldLabel>
          <div className="flex gap-2">
            <Input
              id="desktop-shortcut-keys"
              className="font-mono"
              value={shortcut}
              aria-invalid={!valid}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={!valid || draft === null || draft === current.shortcut || update.isPending}
              onClick={() => {
                if (draft === null) return;
                save({ shortcut: draft });
                setDraft(null);
              }}
            >
              {t("general.desktop.shortcut.save")}
            </Button>
          </div>
          <FieldDescription>
            {valid ? t("general.desktop.shortcut.hint") : t("general.desktop.shortcut.invalid")}
          </FieldDescription>
        </Field>
      )}
    </OptionGroup>
  );
}
