# @workspace/mobile

## 0.35.0

No changes in this release.

## 0.34.0

No changes in this release.

## 0.33.0

No changes in this release.

## 0.32.0

No changes in this release.

## 0.31.0

No changes in this release.

## 0.30.1

No changes in this release.

## 0.30.0

No changes in this release.

## 0.29.0

No changes in this release.

## 0.28.0

No changes in this release.

## 0.27.0

No changes in this release.

## 0.26.2

No changes in this release.

## 0.26.1

No changes in this release.

## 0.26.0

No changes in this release.

## 0.25.2

### Patch Changes

- 810191f: Security and performance hardening.

  - **Reading files:** the agent asks before it reads a file outside the workspace. It never reads PP Agent's own data folder (keys, tokens, settings) or `~/.ssh`.
  - **Browser tool:** looking at pages still runs on its own. Opening pages, clicking, typing and running scripts now ask first, and the agent cannot open addresses on this computer or the local network.
  - **Cookie import:** you pick which sites to import. Imported cookies are stored encrypted.
  - **Telegram and Zalo group chats:** every tool asks the owner first, and yolo mode does not apply. Your personal memory stays out of these chats, and each message shows who sent it. Only the owner can steer a running reply. Wrong pairing codes lock out only the person who sent them.
  - **Phone access:** a phone can no longer set up Telegram or Zalo, choose "always allow" for an app, create or delete workspaces, clear chats or memory, or turn the background service on or off. Devices unused for 30 days are signed out.
    - Requests that name an unknown host are refused.
    - Uploads are written straight to disk.
  - **Web search keys:** changing a search provider's address now clears its saved key.
  - **Approval cards:** cards show the whole command. On Telegram and Zalo, long commands show their start and end.
  - **Workspace skills and MCP servers:** skills in a workspace folder load only after you trust that folder. An MCP server's "read-only" labels count only when you mark the server trusted.
  - **Chat replies:** images from the internet no longer load inside replies.
  - **App and updates:** the app binary is locked down with Electron fuses. Windows updates install in-app only when the build is signed.
  - **Background service:** it no longer restarts every 10 seconds while the app's own background process is running. An existing service file is fixed automatically after the next update. The background log is rotated at 5 MB.
  - **Speed:**
    - The chat list is cached.
    - Long replies stream without re-rendering the whole conversation.
    - Settings load on demand.
    - Older screenshots are dropped from the model's context.
    - The terminal now has flow control.
    - Hidden browser tabs are throttled.
  - **Dependencies:** undici and body-parser are updated for security fixes.

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
