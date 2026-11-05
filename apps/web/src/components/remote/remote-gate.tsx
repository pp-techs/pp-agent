import * as React from "react";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { RefreshCwIcon, WifiOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import logoBlue from "@/assets/logo-mark-blue.png";
import { checkSession, pairDevice, useWebSession } from "@/lib/web-bridge";

/** `#pair=CODE` from the QR code on the computer; removed from the address once read. */
function takeCodeFromAddress(): string | null {
  const match = /(?:^#|&)pair=([A-Za-z0-9-]+)/.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return match[1] ?? null;
}

function PairScreen({ initialCode }: { initialCode: string | null }) {
  const { t } = useTranslation("modals");
  const [code, setCode] = React.useState(initialCode ?? "");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const tried = React.useRef(false);

  const submit = React.useCallback(
    async (value: string) => {
      if (value.trim() === "") return;
      setPending(true);
      setError(null);
      try {
        await pairDevice(value);
        toast.success(t("remote.paired"));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setPending(false);
      }
    },
    [t],
  );

  // A code from the QR code pairs at once; the person only types one by hand.
  React.useEffect(() => {
    if (initialCode && !tried.current) {
      tried.current = true;
      void submit(initialCode);
    }
  }, [initialCode, submit]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <form
        className="flex w-full max-w-sm flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(code);
        }}
      >
        <img src={logoBlue} alt="" className="size-12 self-center" />
        <div className="flex flex-col gap-2 text-center">
          <h1 className="font-heading text-xl font-semibold">{t("remote.pairTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("remote.pairDescription")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="pair-code" className="text-sm font-medium">
            {t("remote.codeLabel")}
          </label>
          <Input
            id="pair-code"
            value={code}
            autoFocus={!initialCode}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("remote.codePlaceholder")}
            aria-invalid={error !== null}
            aria-describedby={error ? "pair-error" : undefined}
            // 16px or more keeps iOS from zooming into the field.
            className="h-12 text-center font-mono text-lg tracking-[0.3em] uppercase"
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/\s/g, ""))}
          />
          {error && (
            <p id="pair-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" className="h-11" disabled={pending || code.trim() === ""}>
          {pending && <Spinner data-icon="inline-start" />}
          {t("remote.pair")}
        </Button>
      </form>
    </main>
  );
}

function UnreachableScreen() {
  const { t } = useTranslation("modals");
  const [pending, setPending] = React.useState(false);
  return (
    <Empty className="min-h-dvh">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WifiOffIcon />
        </EmptyMedia>
        <EmptyTitle>{t("remote.unreachableTitle")}</EmptyTitle>
        <EmptyDescription>{t("remote.unreachableDescription")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          disabled={pending}
          onClick={() => {
            setPending(true);
            void checkSession().finally(() => setPending(false));
          }}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {t("remote.retry")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** A strip at the top while the live connection to the computer is down. */
export function ConnectionBanner() {
  const { t } = useTranslation("modals");
  const connection = useWebSession((state) => state.connection);
  if (connection === "online") return null;
  // A blip while reconnecting is not worth a banner, so it only shows after a moment.
  return (
    <div
      role="status"
      className="delayed-reveal flex shrink-0 items-center justify-center gap-2 bg-muted px-3 py-1.5 text-xs text-muted-foreground"
    >
      <Spinner className="size-3" />
      {t("remote.reconnecting")}
    </div>
  );
}

/** The web app on the local network: pairs the device before showing the app. */
export function RemoteGate({ children }: { children: React.ReactNode }) {
  const phase = useWebSession((state) => state.phase);
  const [initialCode] = React.useState(takeCodeFromAddress);
  React.useEffect(() => {
    void checkSession();
  }, []);

  if (phase === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (phase === "unreachable") return <UnreachableScreen />;
  // A device that is paired already and scanned a code again just opens the app.
  if (phase === "unpaired") return <PairScreen initialCode={initialCode} />;
  return children;
}
