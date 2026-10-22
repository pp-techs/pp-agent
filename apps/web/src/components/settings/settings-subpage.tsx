import * as React from "react";

/** Receives the label of the page open inside a Settings section (an editor), or null. */
const SubPageContext = React.createContext<(label: string | null) => void>(() => {});

export const SettingsSubPageProvider = SubPageContext.Provider;

/** Shows `label` after the section name in the Settings breadcrumb while the caller is mounted. */
export function useSettingsSubPage(label: string) {
  const setSubPage = React.useContext(SubPageContext);
  React.useEffect(() => {
    setSubPage(label);
    return () => setSubPage(null);
  }, [setSubPage, label]);
}
