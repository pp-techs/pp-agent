import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ModalContainer } from "@buiducnhat/better-modal";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "@workspace/ui/components/sonner";
import { TooltipProvider } from "@workspace/ui/components/tooltip";

import "./index.css";
import { App } from "./App.tsx";
import { ThemeProvider, useTheme } from "@/components/theme-provider.tsx";

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
      <ThemeProvider>
        <TooltipProvider>
          <App />
          <ModalContainer />
          <ThemedToaster />
        </TooltipProvider>
      </ThemeProvider>
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </QueryClientProvider>
  </StrictMode>,
);
