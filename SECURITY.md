# Security policy

## Supported versions

Security fixes go into the latest release. Please update to it before reporting.

## Reporting a vulnerability

Do not open a public issue. Report privately through [GitHub security advisories](https://github.com/pp-techs/pp-agent/security/advisories/new) with:

- what an attacker could do, and the conditions they need;
- steps or a proof of concept to reproduce it;
- the PP Agent version and operating system.

We aim to acknowledge reports within 3 business days and to agree on a disclosure date with you once a fix is ready.

## Scope

Of particular interest:

- ways for a model, a document, or an MCP server to run tools or shell commands without the user's approval;
- leaks of API keys or OAuth tokens from the vault or Settings;
- the renderer reaching the network or Node.js APIs outside the preload bridge.

PP Agent sends conversations to the AI providers and MCP servers you configure; what those services do with the data is outside this project's control.
