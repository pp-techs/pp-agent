---
"@workspace/desktop": patch
---

Importing cookies from Chrome, Edge or Brave on Windows now reports an error when the browser protects them with a key only it can unwrap (app-bound encryption) and reading them through the browser itself fails, instead of silently finishing with 0 cookies imported.
