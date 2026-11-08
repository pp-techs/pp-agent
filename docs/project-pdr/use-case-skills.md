# Use case: skills authoring and usage

A skill is an [Agent Skills](https://agentskills.io) folder with a `SKILL.md`, stored under `<user-data>/agent/skills/<name>/`. Besides these, a workspace's own skills in `<workspace folder>/.agents/skills/` are loaded in its chats once the person trusts that folder for skills (`packages/agent-core/src/skills.ts`); nothing else is.

## Built-in skills

The app ships two skills in `apps/desktop/resources/skills/` and copies them into the skills folder at start, leaving a copy the person edited alone (`packages/agent-core/src/skills-builtin.ts`):

- `officecli`: the OfficeCLI workflow behind `office_read` and `office_edit`.
- `skill-creator`: writing and improving skills.

## Author (Settings › Skills)

- **Import** from a folder (copied) or a `.zip` / `.skill` archive (every directory containing `SKILL.md` becomes a skill). Path traversal is rejected; archives expanding beyond 100 MB are refused. An existing name is an error.
- **Create or edit** in the app: name, description, body, and whether the model may load it on its own. Saving writes the frontmatter (`disable-model-invocation: true` when it runs only when asked) and keeps other frontmatter keys; renaming moves the folder.
- **Enable / disable** and delete. Disabled skills are filtered out of sessions.

## Use

- Type `/skill:<name> <args>` in the chat, or pick it from the **+** menu or `/` suggestions; the user bubble shows a "Skill: name" chip.
- The agent also loads skills on its own unless a skill is set to run only when asked.
- A conversation sees the skills that are enabled and in its agent's skills subset, from the installed ones and, when the workspace folder is trusted, its workspace's own (`.agents/skills`). The installed folder is loaded first, so an installed skill wins a name clash and the workspace skill of the same name is never used.

## Trust a workspace's skills

- A downloaded folder can carry skills that steer the agent, so a workspace's own skills stay unloaded until the person turns on **Use the skills this folder carries** in the workspace editor. The trusted folders are saved as `settings.json › trustedSkillFolders` (absolute paths); commands `get_workspace_skills_trust` and `set_workspace_skills_trust { id, trusted }`.
- Trust can only be turned on at the computer: the switch is disabled in the web app, and phone access refuses `set_workspace_skills_trust` with `trusted: true` (turning it off is allowed).
- The skill lists in Settings and the `/` suggestions show only skills that actually load.
