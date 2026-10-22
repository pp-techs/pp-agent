# Use case: skills authoring and usage

A skill is an [Agent Skills](https://agentskills.io) folder with a `SKILL.md`, stored under `<user-data>/agent/skills/<name>/`. Only skills in this folder are loaded (`apps/desktop/src/agent/skills.ts`).

## Author (Settings › Skills)

- **Import** from a folder (copied) or a `.zip` / `.skill` archive (every directory containing `SKILL.md` becomes a skill). Path traversal is rejected; archives expanding beyond 100 MB are refused. An existing name is an error.
- **Create or edit** in the app: name, description, body, and whether the model may load it on its own. Saving writes the frontmatter (`disable-model-invocation: true` when it runs only when asked) and keeps other frontmatter keys; renaming moves the folder.
- **Enable / disable** and delete. Disabled skills are filtered out of sessions.

## Use

- Type `/skill:<name> <args>` in the chat, or pick it from the **+** menu or `/` suggestions; the user bubble shows a "Skill: name" chip.
- The agent also loads skills on its own unless a skill is set to run only when asked.
- A conversation sees only skills that are enabled and in its agent's skills subset.
