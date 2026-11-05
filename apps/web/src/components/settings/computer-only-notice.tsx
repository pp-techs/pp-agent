import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { MonitorIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Shown in the web app above settings a phone may look at but not change. */
export function ComputerOnlyNotice() {
  const { t } = useTranslation("settings");
  return (
    <Alert>
      <MonitorIcon />
      <AlertTitle>{t("remote.computerOnly.title")}</AlertTitle>
      <AlertDescription>{t("remote.computerOnly.description")}</AlertDescription>
    </Alert>
  );
}
