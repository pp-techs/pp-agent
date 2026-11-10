import * as React from "react";
import { type DesktopBridge } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@workspace/ui/components/field";
import { Spinner } from "@workspace/ui/components/spinner";
import { RotateCcwIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmModal } from "@/components/modals/confirm-modal";
import { isWebApp } from "@/lib/bridge";

import { ConfigBundleGroup } from "@/components/settings/config-bundle-group";
import { DiagnosticsGroup } from "@/components/settings/diagnostics-group";
import { SectionHeading } from "@/components/settings/section-heading";
import { describeUpdate, updateAction } from "@/components/update-actions";
import { useUpdateStore } from "@/stores/update-store";

/** The app's version and the one button it offers: check, download, or install. */
function UpdatesField({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const update = useUpdateStore((state) => state.update);
  if (!update) return null;
  const action = updateAction(bridge, update);
  const busy = update.status === "checking" || update.status === "downloading";

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle>{t("advanced.updates.title")}</FieldTitle>
        <FieldDescription>{describeUpdate(update)}</FieldDescription>
      </FieldContent>
      {update.status !== "disabled" && (
        <Button variant="outline" disabled={busy || !action} onClick={() => action?.run()}>
          {busy && <Spinner data-icon="inline-start" />}
          {action?.label ?? t("advanced.updates.check")}
        </Button>
      )}
    </Field>
  );
}

/**
 * Stops the agent daemon and starts one from this build. The person needs it when an older daemon
 * answers with commands it does not know (Settings and the chat then report unknown commands).
 */
function AgentField({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  const [busy, setBusy] = React.useState(false);
  if (isWebApp) return null;

  async function onRestart() {
    const confirmed = await ConfirmModal.show({
      title: t("advanced.agent.confirmTitle"),
      description: t("advanced.agent.confirmDescription"),
      confirmLabel: t("advanced.agent.restart"),
    });
    if (!confirmed) return;
    setBusy(true);
    await bridge.agent
      .restartDaemon()
      .then(() => toast.success(t("advanced.agent.restarted")))
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setBusy(false));
  }

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle>{t("advanced.agent.title")}</FieldTitle>
        <FieldDescription>{t("advanced.agent.description")}</FieldDescription>
      </FieldContent>
      <Button variant="outline" disabled={busy} onClick={() => void onRestart()}>
        {busy ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon />}
        {t("advanced.agent.restart")}
      </Button>
    </Field>
  );
}

/** Settings › Advanced: updates, the setup bundle and the log, away from the everyday pages. */
export function AdvancedSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading title={t("advanced.title")} description={t("advanced.description")} />
      <UpdatesField bridge={bridge} />
      <AgentField bridge={bridge} />
      <ConfigBundleGroup bridge={bridge} />
      <DiagnosticsGroup bridge={bridge} />
    </div>
  );
}
