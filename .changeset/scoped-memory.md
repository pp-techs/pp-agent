---
"@workspace/desktop": minor
---

Long-term memory is now scoped: every note lives either everywhere or in one workspace only, so project facts no longer leak into other projects. `memory_save` takes a `scope` (`global` or `workspace`), the tools and the `## Memory` prompt section show a conversation every workspace's notes plus its own, and Settings › Memory groups the notes by place with a place picker when adding (editing can move a note). The workspace editor manages that workspace's notes directly. Each place holds its own 200 notes; deleting a workspace forgets its notes.
