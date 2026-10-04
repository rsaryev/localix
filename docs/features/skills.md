# Reuse procedures with skills

Skills are local `SKILL.md` files that give the agent a named procedure, description, and optional
invocation controls. Use them once with `/name`, pin them to a session, or let the agent load one
when its description matches the task.

**Discovery boundary:** a session scans its own working directory's skill directory; a chat in the
**Default** project scans the personal skill directory instead.

## What you can do

| Task                       | Mechanism                                                                                            | Boundary                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Run a skill once           | Enter `/name [arguments]` or select it from the web slash menu.                                      | Selection inserts a one-shot command; it does not pin the skill.                         |
| Keep a skill active        | Pin it to the session through the session-skills API.                                                | The full skill body is added to that session's runtime prompt.                           |
| Create or revise a skill   | Use Settings → Capabilities → Skills for the selected filesystem scope.                              | Plugin-bundled skills are read-only in this manager.                                     |
| Let the agent load a skill | The runtime lists names and descriptions; the agent can fetch a matching body with the `skill` tool. | Bodies are loaded on demand rather than placing every skill in the prompt.               |
| Archive stale skills       | Run the curator or archive a filesystem skill manually.                                              | Archived directories are excluded from discovery until restored.                         |
| Deny one agent a skill     | Switch it off on that agent's profile → Skills, or on Settings → Capabilities → Skills.              | The switch writes one `skill:<name>` rule; the file and every other agent are untouched. |
| Control visibility         | Apply per-skill overrides such as on, off, name-only, or user-invocable-only.                        | Overrides change discovery and invocation eligibility, not the file contents.            |

## How it works

### Terms

| Term             | Meaning                                                   |
| ---------------- | --------------------------------------------------------- |
| Filesystem skill | A directory containing a readable `SKILL.md`.             |
| Project skill    | A skill under `<working-directory>/.localix/skills`.      |
| Personal skill   | A skill under `~/.localix/skills`, used by scratch chats. |
| Plugin skill     | A read-only skill contributed by an enabled plugin.       |
| Session pin      | A skill name whose full body is injected for one session. |
| Curator pin      | Protection from automatic stale-skill archiving.          |

### Discovery and precedence

| Session scope   | Filesystem root scanned               | Additional source     |
| --------------- | ------------------------------------- | --------------------- |
| Project         | `<working-directory>/.localix/skills` | Enabled plugin skills |
| Default project | `~/.localix/skills`                   | Enabled plugin skills |

The scanner walks nested directories to find `SKILL.md`, up to six levels and 2,000 entries per
root. It follows a symlink only when the canonical target remains inside the scanned safety root.

Built-in slash commands keep precedence over a skill with the same name. Within one filesystem scan,
the first sorted match wins and a duplicate-name warning identifies the ignored path.

### Loading and invocation

The runtime initially gives the model a bounded roster of skill names and descriptions. The `skill`
tool can list that roster or load one body; plugin skills can be read but not saved or deleted
through the tool.

One-shot `/name` invocation expands supported arguments before submitting the prompt. Filesystem
skills can also opt into bounded local command expansion and confined file-reference expansion. A
skill with `context: fork` runs in a child agent; other skills run in the current session.

Session pins persist with the session record. The runtime injects each resolvable pinned body under
an active-skills prompt section on subsequent turns.

The supported frontmatter, substitution tokens, tool policy, and command-expansion limits belong to
the [skill authoring guide](../extending/skills-authoring.md).

### Management and curation

Settings can create, edit, delete, archive, restore, and curator-pin filesystem skills in the
selected scope. Same-name edits replace that skill's managed name, description, and body while
preserving other frontmatter.

The curator classifies an unpinned filesystem skill as stale when it has never been used for more
than 30 days or was last used more than 90 days ago. Automatic checks run once the app is idle after
startup and then daily, but an archive pass runs at most once every seven days.

Successful one-shot invocation and agent body loading update usage records. Archiving moves the
directory under the scope's `.archive` folder; restoring moves it back into discovery.

## Configuration

| Setting or surface                    | Effect                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| `<working-directory>/.localix/skills` | Stores skills for that project scope.                              |
| `~/.localix/skills`                   | Stores skills for scratch chats.                                   |
| Settings → Capabilities → Skills      | Manages filesystem skills and curator actions by scope.            |
| Web slash menu                        | Inserts a one-shot `/name` invocation.                             |
| Session-skills API                    | Replaces the session's persisted pinned-skill list.                |
| Skill overrides                       | Changes discovery or user-invocation visibility for a named skill. |

## Limits

- Project and personal filesystem skills are merged, project first: a repository's own skill shadows
  a personal one of the same name. Where a skill lives decides who it travels with, not whether you
  can use it.
- Foreign skill folders such as `.claude/skills`, `.claude/commands`, and `.agents/skills` are not
  scanned.
- Symlinks cannot extend discovery outside the selected safety root. Archived directories are also
  excluded.
- Localix supports a defined `SKILL.md` contract, not every convention used by other tools. Check
  the authoring guide before relying on a field or expansion.
- The web slash menu runs a skill once and the web pinned-skill row can remove existing pins; adding
  a persistent pin is currently exposed only through the session-skills API.
- Renaming a skill in the current Settings editor creates the new name without removing the old
  directory. Delete the old skill explicitly after verifying the new one.
- Filesystem skills may execute declared local shell expansions or read confined file references
  during one-shot invocation. Review skill files as executable local instructions.
- Validator warnings are findings, not load blockers. An unreadable file or a skill with neither
  usable description nor body is rejected.
- Automatic curator passes operate on personal skills. Run the curator explicitly for a project
  scope.
- Curator pins prevent automatic archiving; they do not pin a skill into a chat session.

## Related guides

- [Author skills](../extending/skills-authoring.md)
- [Plugins](../extending/plugins.md)
- [Learning loop](learning-loop.md)
- [Human-in-the-loop controls](hitl.md)
- [Capabilities](capabilities.md)

## Source of truth

- [Filesystem discovery and scope selection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/skill-discovery.ts)
- [Skill scanning and safety bounds](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/skill-scan.ts)
- [One-shot skill command expansion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/skill-commands.ts)
- [Session pin resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/skills.ts)
- [Runtime prompt injection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/prompt-skills.ts)
- [Skill manager operations](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/skill-ops.ts)
- [Curator scheduling and policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/skills-curator/service.ts)
- [Web skill-command selection](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/ui/prompt-input/useSkillCommands.tsx)
