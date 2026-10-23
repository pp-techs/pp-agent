import * as React from "react";
import { resolveLanguage } from "@workspace/shared/i18n";
import { useQuery } from "@tanstack/react-query";

import { bridge } from "@/lib/bridge";
import { i18n } from "@/lib/i18n";
import { settingsQuery } from "@/lib/queries";

/** Applies the language chosen in Settings › General (or the system's) to the whole interface. */
function Sync({ bridge: desktop }: { bridge: NonNullable<typeof bridge> }) {
  const settings = useQuery(settingsQuery(desktop));
  const setting = settings.data?.language;
  React.useEffect(() => {
    if (!setting) return;
    const language = resolveLanguage(setting, navigator.language);
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [setting]);
  return null;
}

export function LanguageSync() {
  return bridge ? <Sync bridge={bridge} /> : null;
}
