import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ModalContainer } from "@buiducnhat/better-modal";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "@workspace/ui/components/sonner";
import { TooltipProvider } from "@workspace/ui/components/tooltip";

import "./index.css";
import { App } from "./App.tsx";
import { AppUiLabels } from "@/components/ui-labels-provider.tsx";
import { LanguageSync } from "@/components/language-sync.tsx";
import { ThemeProvider, useTheme } from "@/components/theme-provider.tsx";
import { i18n } from "@/lib/i18n.ts";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="top-center" theme={theme} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <LanguageSync />
        <AppUiLabels>
          <ThemeProvider>
            <TooltipProvider>
              <App />
              <ModalContainer />
              <ThemedToaster />
            </TooltipProvider>
          </ThemeProvider>
        </AppUiLabels>
      </I18nextProvider>
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </QueryClientProvider>
  </StrictMode>,
);
