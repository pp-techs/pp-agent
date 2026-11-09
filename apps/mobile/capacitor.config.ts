import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The phone app is the web app (built by `vp run @workspace/web#build:mobile` into `www/`) in a
 * native shell. It talks to the computer's Remote access server, which answers plain HTTP on the
 * local network or a Tailscale address, so both platforms allow cleartext requests to it.
 */
const config: CapacitorConfig = {
  appId: "com.pptechs.agent",
  appName: "PP Agent",
  webDir: "www",
  server: {
    // The page is `http://localhost` on Android: a secure context that may still fetch `http:`
    // addresses, which an `https://localhost` page could not (mixed content). On iOS it is
    // `capacitor://localhost`. The computer accepts requests from exactly these two origins.
    androidScheme: "http",
    cleartext: true,
  },
  plugins: {
    SystemBars: { insetsHandling: "native", initialViewportFitValueHint: "cover" },
    // The Web View shrinks to the space above the keyboard, so the composer sits right on it
    // (and the home indicator's safe-area padding goes away while typing).
    Keyboard: { resize: "native" },
  },
};

export default config;
