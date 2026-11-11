---
"@workspace/desktop": minor
"@workspace/web": minor
---

Settings › Connectors has **PP Hub**: enter your company's hub address (`hub.acme.vn`), and the app saves `<address>/mcp/` and signs in right away. Hubs authorize through Logto, which registers no OAuth clients, so the entry asks the sign-in to name the app with its Client ID Metadata Document, and to ask for `openid offline_access` — Logto always asks for consent and denies a request that names no scope, while the hub's own tokens still carry none. Every hub a person adds is its own server (`pp-hub`, `pp-hub-2`…), grouped on one card by the `connector` written into `mcp.json`; a server added by hand still shows as a custom card.
