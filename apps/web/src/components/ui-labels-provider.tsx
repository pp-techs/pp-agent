import * as React from "react";
import { UiLabelsProvider, type UiLabels } from "@workspace/ui/components/ui-labels";
import { useTranslation } from "react-i18next";

/** Feeds the shared UI components their screen-reader texts in the current language. */
export function AppUiLabels({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("modals");
  const labels = React.useMemo<UiLabels>(
    () => ({
      close: t("ui.close"),
      toggleSidebar: t("ui.toggleSidebar"),
      sidebarMobileTitle: t("ui.sidebarMobileTitle"),
      sidebarMobileDescription: t("ui.sidebarMobileDescription"),
      loading: t("ui.loading"),
      copy: t("ui.copy"),
      copied: t("ui.copied"),
      scrollToEnd: t("ui.scrollToEnd"),
      scrollToStart: t("ui.scrollToStart"),
    }),
    [t],
  );
  return <UiLabelsProvider labels={labels}>{children}</UiLabelsProvider>;
}
