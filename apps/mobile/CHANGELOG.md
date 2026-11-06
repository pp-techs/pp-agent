# @workspace/mobile

## 0.25.1

### Patch Changes

- 3c54f4c: PP Agent has a new logo: leaves growing around one core. It shows in the sidebar, on the empty chat screen and on the connect screen, in brand blue on light and dark themes, with a bolder version at small sizes. The app icon, tray icon, browser tab icon, and the iOS and Android icons and splash screens use it too.

## 0.25.0

No changes in this release.

## 0.24.1

### Patch Changes

- 7ec24b5: The iPhone app connects to a computer's Tailscale address (100.x.y.z) too; before, iOS blocked plain HTTP to it and the app said it could not reach the computer.

## 0.24.0

### Minor Changes

- cc137a9: PP Agent for iOS and Android: a phone app that connects to PP Agent on your computer through Phone access. Scan the pairing QR code in Settings › Phone access to connect and pair in one step, or type the computer's address (a Tailscale address works too). The app keeps you signed in, can use the microphone for voice input, and shares exported conversations through the phone's share sheet. Build it from `apps/mobile` with Xcode or Android Studio; it is not in the app stores yet.

  On phones the composer keeps its buttons on one row: a long model name is shortened and the thinking level shows as an icon.
