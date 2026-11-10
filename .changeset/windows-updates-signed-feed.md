---
"@workspace/desktop": patch
---

Windows updates install in the app again without a code-signing certificate: every release feed carries an Ed25519 signature that the app verifies, together with the downloaded installer's hash, before it installs.
