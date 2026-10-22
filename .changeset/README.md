# Changesets

Every change people will notice in the app needs a changeset: a small Markdown file in this folder that names the release type and describes the change in a sentence or two. Create one with:

```bash
vp run changeset
```

Pick `@workspace/desktop` (the app; `@workspace/web` is released in lockstep with it) and the bump:

| Bump    | When                                                                  |
| ------- | --------------------------------------------------------------------- |
| `patch` | Bug fixes and small improvements                                      |
| `minor` | New features, or (before 1.0) changes that need users to act          |
| `major` | Breaking changes to saved data or behaviour, once the app reaches 1.0 |

Write the description for the release notes: what changed for the person using the app, not how it was implemented. Docs, CI, and internal refactors need no changeset.

The release workflow turns pending changesets into a "Version Packages" pull request; merging it releases the app. See [docs/code-standard/release-process.md](../docs/code-standard/release-process.md).
