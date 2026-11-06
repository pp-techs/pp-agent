# @workspace/daemon

## 0.9.0

### Minor Changes

- cc137a9: PP Agent for iOS and Android: a phone app that connects to PP Agent on your computer through Phone access. Scan the pairing QR code in Settings › Phone access to connect and pair in one step, or type the computer's address (a Tailscale address works too). The app keeps you signed in, can use the microphone for voice input, and shares exported conversations through the phone's share sheet. Build it from `apps/mobile` with Xcode or Android Studio; it is not in the app stores yet.
  
  On phones the composer keeps its buttons on one row: a long model name is shortened and the thinking level shows as an icon.

### Patch Changes

- Updated dependencies [cc137a9]
  - @workspace/shared@0.0.3
  - @workspace/agent-core@0.0.3

## 0.8.0

### Minor Changes

- 6df5258: Phone access: use PP Agent from a phone (or another computer) on the same network, in its web browser. Turn it on in **Settings › Phone access**, scan the QR code, and the phone pairs in one step; then chat, attach photos and files, answer approvals, and change most settings from a layout made for small screens (full-screen Settings with a section list, actions always visible on touch, safe areas, add to home screen). The daemon serves the app, so it keeps working with the window closed when PP Agent runs in the background. Paired devices are listed with Unpair; pairing codes are one-time and expire after 10 minutes. The connection is plain HTTP, so Settings warns to use it only on trusted networks, and settings that let the agent run programs without asking (MCP servers, tool permissions, turning on the shell or yolo mode) can only be changed on the computer.

### Patch Changes

- Updated dependencies [6df5258]
  - @workspace/shared@0.0.2
  - @workspace/agent-core@0.0.2

## 0.7.2

### Patch Changes

- Updated dependencies [b3fe6fb]
- Updated dependencies [b3fe6fb]
  - @workspace/shared@0.0.1
  - @workspace/agent-core@0.0.1
