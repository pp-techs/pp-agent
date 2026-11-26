---
"@workspace/agent-core": minor
"@workspace/shared": minor
"@workspace/web": minor
---

Upgrade memory, cross-session recall, subagent delegation, and guarded skill management:

- Add two-pass secret redaction and invisible Unicode stripping across memory extraction, subagent summaries (before truncation), and session recall.
- Reserve split prompt budget between global/profile notes and workspace notes in `memorySection`, warn to consolidate when memory reaches 85% capacity, and trigger memory extraction before compaction.
- Add full-text cross-session `search` (accent-insensitive, relative/ISO time bounds, demoting scheduled runs below interactive chats) and `history` scroll mode (`around`) to the `sessions` tool.
- Add `PrefixCacheGate` for parallel subagent batches, progress-based stale timeout detection, optional `outputSchema` JSON validation with a single bounded retry turn, and skill inheritance for named helper agents.
- Add guarded `skill_manage` tool (`list`, `read`, `history`, `create`, `patch`, `archive`, `rollback`) with per-action read/write approval tiers, read-before-write guard, secret blocking, recoverable `.archive/` retirement, and content-addressed SHA-256 audit ledger rollback (`SkillLedger`).
