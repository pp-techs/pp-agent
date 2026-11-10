import { type DesktopBridge } from "@workspace/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { useTranslation } from "react-i18next";

import { BrowserSettings } from "@/components/settings/browser-settings";
import { ComputerSettings } from "@/components/settings/computer-settings";
import { SectionHeading } from "@/components/settings/section-heading";

/** Settings › This computer: the browser the agent drives, and the apps it may use. */
export function ThisComputerSection({ bridge }: { bridge: DesktopBridge }) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title={t("computerSection.title")}
        description={t("computerSection.description")}
      />
      <Tabs defaultValue="browser" className="gap-4">
        <TabsList>
          <TabsTrigger value="browser">{t("computerSection.tabs.browser")}</TabsTrigger>
          <TabsTrigger value="apps">{t("computerSection.tabs.apps")}</TabsTrigger>
        </TabsList>
        <TabsContent value="browser">
          <BrowserSettings bridge={bridge} />
        </TabsContent>
        <TabsContent value="apps">
          <ComputerSettings bridge={bridge} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
