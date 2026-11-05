# @workspace/daemon

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
