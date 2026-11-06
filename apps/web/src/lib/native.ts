import { Capacitor } from "@capacitor/core";

/**
 * True inside the phone app (apps/mobile): the web app bundled into a Capacitor shell. It runs the
 * web bridge like a browser on the local network, but its page is not served by the computer, so
 * the person picks which computer to talk to (see `connectToServer` in web-bridge.ts).
 */
export const isNativeApp = Capacitor.isNativePlatform();

/**
 * Makes the phone app's keyboard behave like a native app's: no Previous/Next/Done bar above it
 * (WKWebView adds one for form fields), with the Web View resized to the space above the keyboard
 * (`Keyboard.resize` in capacitor.config.ts) and no home-indicator padding under the composer, so it
 * sits right on top of the keyboard.
 */
export function setUpNativeKeyboard(): void {
  void import("@capacitor/keyboard")
    .then(async ({ Keyboard }) => {
      // Tells the CSS (`--safe-bottom`) to drop the home indicator's padding while typing.
      const root = document.documentElement;
      await Keyboard.addListener("keyboardWillShow", () => (root.dataset.keyboard = "open"));
      await Keyboard.addListener("keyboardWillHide", () => delete root.dataset.keyboard);
      if (Capacitor.getPlatform() === "ios")
        await Keyboard.setAccessoryBarVisible({ isVisible: false });
    })
    .catch(() => undefined);
}

/** The scanner's error when the person closed it without scanning. */
const CANCELLED = "OS-PLUG-BARC-0006";

/**
 * Opens the camera to read a QR code; resolves with its text, or null when the person closed the
 * scanner. Only in the phone app: the plugin (and its web fallback) loads on first use.
 */
export async function scanQrCode(instructions: string): Promise<string | null> {
  const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } =
    await import("@capacitor/barcode-scanner");
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      scanInstructions: instructions,
    });
    return result.ScanResult || null;
  } catch (error) {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
    if (code === CANCELLED || (typeof message === "string" && /cancel/i.test(message))) return null;
    throw error;
  }
}

/**
 * Hands a text file to the system share sheet (save to Files, AirDrop, mail…): the app's WebView
 * has no downloads. Native plugins, not `navigator.share`, because that needs a fresh tap and
 * exports first wait for the computer. False when the person closed the sheet.
 */
export async function shareTextFile(name: string, content: string): Promise<boolean> {
  const [{ Directory, Encoding, Filesystem }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  // The name comes from the computer: keep it one plain file inside exports/.
  const file = name.replace(/[/\\]/g, "-").replace(/^\.+$/, "export");
  const { uri } = await Filesystem.writeFile({
    path: `exports/${file}`,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  try {
    await Share.share({ files: [uri], title: name });
    return true;
  } catch (error) {
    if (error instanceof Error && /cancel/i.test(error.message)) return false;
    throw error;
  }
}
