---
"@workspace/desktop": minor
"@workspace/web": minor
"@workspace/mobile": minor
"@workspace/daemon": minor
"@workspace/shared": patch
---

PP Agent for iOS and Android: a phone app that connects to PP Agent on your computer through Phone access. Scan the pairing QR code in Settings › Phone access to connect and pair in one step, or type the computer's address (a Tailscale address works too). The app keeps you signed in, can use the microphone for voice input, and shares exported conversations through the phone's share sheet. Build it from `apps/mobile` with Xcode or Android Studio; it is not in the app stores yet.

On phones the composer keeps its buttons on one row: a long model name is shortened and the thinking level shows as an icon.
