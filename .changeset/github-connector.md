---
"@workspace/desktop": minor
"@workspace/web": minor
---

Settings › Connectors has **GitHub**. GitHub registers no OAuth clients, so Connect asks for a personal access token (with a link to where to create one) in a masked field and saves it as the `Authorization` header of GitHub's remote MCP server; a second account is added with its own token. The token stays in `mcp.json` on this computer and is never sent to a phone. Zoho Mail was already covered by the Email card.
