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
import { Separator } from "@workspace/ui/components/separator";
import { REMOTE_DEFAULT_PORT } from "@workspace/shared";
import { MonitorSmartphoneIcon, QrCodeIcon, RefreshCwIcon, WifiOffIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import logoBlue from "@/assets/logo-mark-blue.png";
import { isNativeApp, scanQrCode } from "@/lib/native";
import {
  checkSession,
  connectToServer,
  forgetServer,
  pairDevice,
  useWebSession,
} from "@/lib/web-bridge";
import { parseServerAddress } from "@/lib/server-address";

/** `#pair=CODE` from the QR code on the computer; removed from the address once read. */
function takeCodeFromAddress(): string | null {
  const match = /(?:^#|&)pair=([A-Za-z0-9-]+)/.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return match[1] ?? null;
}

function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** Welcomes the device once pairing went through. */
function greetIfPaired(message: string): void {
  if (useWebSession.getState().phase === "paired") toast.success(message);
}

/**
 * The phone app's scan of the computer's QR code: connects to that computer, and pairs in the same
 * go when the code carries a pairing code. `onError` gets a message for the person; closing the
 * scanner is no error.
 */
function useScanToPair(onError: (message: string | null) => void) {
  const { t } = useTranslation("modals");
  const [pending, setPending] = React.useState(false);
  const scan = React.useCallback(async () => {
    onError(null);
    let text: string | null;
    try {
      text = await scanQrCode(t("remote.scanInstructions"));
    } catch (failure) {
      onError(t("remote.scanFailed", { error: messageOf(failure) }));
      return;
    }
    if (text === null) return;
    // The QR code holds the pairing code only while pairing is open on the computer; without it
    // the app still connects, and the pairing screen asks for the code.
    const link = parseServerAddress(text, REMOTE_DEFAULT_PORT);
    if (!link) {
      onError(t("remote.notPairingCode"));
      return;
    }
    setPending(true);
    try {
      await connectToServer(link.server, link.code);
      greetIfPaired(t("remote.paired"));
    } catch (failure) {
      onError(messageOf(failure));
    } finally {
      setPending(false);
    }
  }, [onError, t]);
  return { scan, pending };
}

function ScanButton({
  onError,
  variant = "default",
}: {
  onError: (message: string | null) => void;
  variant?: "default" | "outline";
}) {
  const { t } = useTranslation("modals");
  const { scan, pending } = useScanToPair(onError);
  return (
    <Button
      type="button"
      size="lg"
      variant={variant}
      className="h-11"
      disabled={pending}
      onClick={() => void scan()}
    >
      {pending ? <Spinner data-icon="inline-start" /> : <QrCodeIcon data-icon="inline-start" />}
      {t("remote.scanQr")}
    </Button>
  );
}

/** Where the phone app is connected, with a way to pick another computer. */
function ComputerLine() {
  const { t } = useTranslation("modals");
  const server = useWebSession((state) => state.server);
  if (!isNativeApp) return null;
  return (
    <div className="flex flex-col items-center gap-1 text-center text-sm text-muted-foreground">
      {server && <span className="font-mono text-xs break-all">{server}</span>}
      <Button type="button" variant="link" size="sm" onClick={forgetServer}>
        {t("remote.otherComputer")}
      </Button>
    </div>
  );
}

const SCREEN =
  "flex min-h-dvh items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]";

/** The phone app before it knows a computer: scan the pairing QR code, or type the address. */
function ConnectScreen() {
  const { t } = useTranslation("modals");
  const [address, setAddress] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    const link = parseServerAddress(address, REMOTE_DEFAULT_PORT);
    if (!link) {
      setError(t("remote.badAddress"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await connectToServer(link.server, link.code);
      greetIfPaired(t("remote.paired"));
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className={SCREEN}>
      <div className="flex w-full max-w-sm flex-col gap-5">
        <img src={logoBlue} alt="" className="size-12 self-center" />
        <div className="flex flex-col gap-2 text-center">
          <h1 className="font-heading text-xl font-semibold">{t("remote.connectTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("remote.connectDescription")}</p>
        </div>
        <ScanButton onError={setError} />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Separator className="flex-1" />
          {t("remote.orTypeAddress")}
          <Separator className="flex-1" />
        </div>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="computer-address" className="text-sm font-medium">
            {t("remote.addressLabel")}
          </label>
          <Input
            id="computer-address"
            value={address}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("remote.addressPlaceholder")}
            aria-invalid={error !== null}
            aria-describedby={error ? "connect-error" : "connect-hint"}
            // 16px or more keeps iOS from zooming into the field.
            className="h-11 font-mono text-base"
            onChange={(event) => setAddress(event.target.value)}
          />
          {error ? (
            <p id="connect-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : (
            <p id="connect-hint" className="text-xs text-muted-foreground">
              {t("remote.addressHint")}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            variant="outline"
            className="mt-1 h-11"
            disabled={pending || address.trim() === ""}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <MonitorSmartphoneIcon data-icon="inline-start" />
            )}
            {t("remote.connect")}
          </Button>
        </form>
      </div>
    </main>
  );
}

function PairScreen({ initialCode }: { initialCode: string | null }) {
  const { t } = useTranslation("modals");
  const [code, setCode] = React.useState(initialCode ?? "");
  const [pending, setPending] = React.useState(false);
  const [ownError, setOwnError] = React.useState<string | null>(null);
  // A scanned code that failed to pair while the connect screen was still up.
  const pairError = useWebSession((state) => state.pairError);
  const error = ownError ?? pairError;
  const setError = React.useCallback((message: string | null) => {
    setOwnError(message);
    if (message === null) useWebSession.setState({ pairError: null });
  }, []);
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
        setError(messageOf(failure));
      } finally {
        setPending(false);
      }
    },
    [setError, t],
  );

  // A code from the QR code pairs at once; the person only types one by hand.
  React.useEffect(() => {
    if (initialCode && !tried.current) {
      tried.current = true;
      void submit(initialCode);
    }
  }, [initialCode, submit]);

  return (
    <main className={SCREEN}>
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
          <p className="text-sm text-muted-foreground">
            {t(isNativeApp ? "remote.pairDescriptionApp" : "remote.pairDescription")}
          </p>
        </div>
        {isNativeApp && <ScanButton onError={setError} variant="outline" />}
        <div className="flex flex-col gap-2">
          <label htmlFor="pair-code" className="text-sm font-medium">
            {t("remote.codeLabel")}
          </label>
          <Input
            id="pair-code"
            value={code}
            autoFocus={!initialCode && !isNativeApp}
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
        <ComputerLine />
      </form>
    </main>
  );
}

function UnreachableScreen() {
  const { t } = useTranslation("modals");
  const [pending, setPending] = React.useState(false);
  const server = useWebSession((state) => state.server);
  return (
    <Empty className="min-h-dvh">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WifiOffIcon />
        </EmptyMedia>
        <EmptyTitle>{t("remote.unreachableTitle")}</EmptyTitle>
        <EmptyDescription>
          {isNativeApp
            ? t("remote.unreachableDescriptionApp", { server })
            : t("remote.unreachableDescription")}
        </EmptyDescription>
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
        {isNativeApp && (
          <Button variant="ghost" onClick={forgetServer}>
            {t("remote.otherComputer")}
          </Button>
        )}
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

/**
 * The web app on the local network and the phone app: pairs the device (the app first connects
 * to a computer) before showing the app.
 */
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
  if (phase === "noComputer") return <ConnectScreen />;
  if (phase === "unreachable") return <UnreachableScreen />;
  // A device that is paired already and scanned a code again just opens the app.
  if (phase === "unpaired") return <PairScreen initialCode={initialCode} />;
  return children;
}
