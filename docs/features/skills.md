# Reuse procedures with skills

Skills are local `SKILL.md` files that give the agent a named procedure, description, and optional
invocation controls. Use them once with `/name`, pin them to a session, or let the agent load one
when its description matches the task.

**Discovery boundary:** a session reads personal skills (`~/.localix/skills`, `~/.claude/skills`,
`~/.claude/commands`), then the project's (`.localix/skills`, `.claude/skills`, `.agents/skills`,
`.claude/commands`) in the working directory and every parent up to the repository root. A chat in
the **Default** project reads the personal ones.

## What you can do

| Task                       | Mechanism                                                                                            | Boundary                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Run a skill once           | Enter `/name [arguments]` or select it from the web slash menu.                                      | Selection inserts a one-shot command; it does not pin the skill.                         |
| Let the agent run it       | Write `/name` as its own word later in a message (`go ahead and /deploy to staging`).                | Permission for that message, a user-only skill included; the agent decides whether to.   |
| Keep a skill active        | Pin it to the session through the session-skills API.                                                | The full skill body is added to that session's runtime prompt.                           |
| Create or revise a skill   | Use Settings → Capabilities → Skills for the selected filesystem scope.                              | Plugin-bundled skills are read-only in this manager.                                     |
| Let the agent load a skill | The runtime lists names and descriptions; the agent can fetch a matching body with the `skill` tool. | Bodies are loaded on demand rather than placing every skill in the prompt.               |
| Archive stale skills       | Run the curator or archive a filesystem skill manually.                                              | Archived directories are excluded from discovery until restored.                         |
| Deny one agent a skill     | Switch it off on that agent's profile → Skills, or on Settings → Capabilities → Skills.              | The switch writes one `skill:<name>` rule; the file and every other agent are untouched. |
| Control availability       | Enable or disable a named skill for the selected agent.                                              | Disabling removes access by name, including pins and keyword triggers; files remain.     |

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

| Session scope   | Folders read, in precedence order                                                                                                                                                                                 | Additional source     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Project         | `~/.localix/skills`, `~/.claude/skills`, `~/.claude/commands`, then in the working directory and each parent up to the repository root: `.localix/skills`, `.claude/skills`, `.agents/skills`, `.claude/commands` | Enabled plugin skills |
| Default project | `~/.localix/skills`, `~/.claude/skills`, `~/.claude/commands`                                                                                                                                                     | Enabled plugin skills |

A command file `.claude/commands/<path>.md` is a skill named by its path with each `/` a `:`
(`commands/git/commit.md` is `/git:commit`); it takes a skill's frontmatter except `name` and
`paths`.

The scanner walks nested directories to find `SKILL.md`, up to six levels and 2,000 entries per
root. Project symlinks must resolve inside the session's working directory. Personal skill symlinks
may point outside the home directory; plugin skill links stay inside their declared root.

Built-in slash commands keep precedence over a skill with the same name. As in Claude Code, a
personal skill takes precedence over a project skill of the same name, a nearer project folder over
a parent's, a skill over a command file, and within one folder Localix's own skills over
`.claude/skills` and portable `.agents/skills`. Two skills of one name in the same place keep the
first sorted one, with a duplicate-name warning. Portable project skills are read sources: the
Localix manager does not delete or archive them. Saving the same name creates a native Localix copy
that shadows the portable procedure.

### Loading and invocation

The runtime initially gives the model a bounded roster of skill names and descriptions. The roster
lists each description up to 1,536 characters, as Claude Code does, within an 8,000-code-unit
budget: descriptions shorten to bare names before any name is omitted with a notice. The `skill`
tool can list that roster or load one body; plugin skills can be read but not saved or deleted
through the tool. Default delegated workers can also retrieve skills. An agent's explicit tool list
and capability denials still control availability; pinning a skill supplies its body even without
the retrieval tool.

One-shot `/name` invocation expands supported arguments before submitting the prompt. Filesystem
skills can also opt into bounded local command expansion and confined file-reference expansion. A
skill with `context: fork` runs in a child session, typed or loaded by the agent, as the subagent
type its `agent:` names (`Explore`, `Plan`, a plugin agent; the invoking agent by default). Other
skills run in the current session. Child sessions cannot fork skills into more child sessions.

Session pins persist with the session record. The runtime injects each resolvable pinned body under
an active-skills prompt section on subsequent turns, within a shared 32,000-code-unit budget.
Unavailable or unreadable pins are omitted. Agent-profile preloads use the same prompt section.

A skill can declare `keywords` to load its body when a phrase matches the latest non-internal user
message. Matching is case-insensitive, respects word boundaries, and tolerates whitespace within
phrases. These triggers do not inspect tool output. Hiding a skill from the model roster does not
disable its keyword trigger; agent availability rules do.

Current slash invocation and session-pin APIs resolve filesystem skills. Enabled plugin procedures
are available through the model-facing `skill` tool and agent preloads; these are separate from
plugin slash commands.

The supported frontmatter, substitution tokens, tool policy, and command-expansion limits belong to
the [skill authoring guide](../extending/skills-authoring.md).

### Management and curation

Settings can create, edit, delete, archive, restore, and curator-pin filesystem skills in the
selected scope. Same-name edits replace that skill's managed name, description, and body while
preserving other frontmatter.

The curator classifies an unpinned filesystem skill as stale when it has never been used for more
than 30 days or was last used more than 90 days ago. Automatic checks run once the app is idle after
startup and then daily, but an archive pass runs at most once every seven days. The first automatic
observation only saves the schedule marker and waits a full interval before archiving.

One-shot slash preprocessing and successful `skill.get` record usage on a best-effort basis; they do
not prove that the procedure completed. Pinning and keyword injection do not update this usage
counter. A never-used skill's age comes from its usage record or file modification time.

Curator inventory covers native Localix skills in the selected scope, without the runtime's personal
fallback or portable sources. Archiving moves the directory into a sibling `.archive` folder;
restoring moves it back and records a use. Archiving can replace a same-directory archive with the
same name. Curator pins protect automatic passes, but manual archive remains available.

## Configuration

| Setting or surface                    | Effect                                                      |
| ------------------------------------- | ----------------------------------------------------------- |
| `<working-directory>/.localix/skills` | Stores skills for that project scope.                       |
| `~/.localix/skills`                   | Stores skills for scratch chats.                            |
| Settings → Capabilities → Skills      | Manages filesystem skills and curator actions by scope.     |
| Web slash menu                        | Inserts a one-shot `/name` invocation.                      |
| Session-skills API                    | Replaces the session's persisted pinned-skill list.         |
| Agent skill rules                     | Enables or disables access to a named skill for that agent. |

## Limits

- Personal and project skills are merged, personal first, as in Claude Code: a personal skill
  shadows a project skill of the same name.
- Personal `.agents/skills` is not read. Skills in a folder below the working directory are not read
  either; start the session there to use them.
- Skills read from `.claude/` and `.agents/` are read sources: the Settings manager writes, deletes
  and archives only `.localix/skills`.
- Project and plugin symlinks cannot extend discovery outside their safety root; personal skill
  links can. Archived and hidden subdirectories are excluded, and a discovered skill's assets are
  not scanned for nested skills.
- Localix supports a defined `SKILL.md` contract, not every convention used by other tools. Check
  the authoring guide before relying on a field or expansion.
- The web slash menu runs a skill once and the web pinned-skill row can remove existing pins; adding
  a persistent pin is currently exposed only through the session-skills API.
- Renaming a skill in the current Settings editor creates the new name without removing the old
  directory. Delete the old skill explicitly after verifying the new one.
- Filesystem skills may execute declared local shell expansions or read confined file references
  during one-shot invocation. Review skill files as executable local instructions.
- Validator warnings are findings, not load blockers. Discovery rejects unreadable files, invalid
  UTF-8, files over 1 MiB, and empty Markdown bodies, including description-only files.
- Automatic curator passes operate on personal skills. Run the curator explicitly for a project
  scope.
- Curator pins prevent automatic archiving; they do not pin a skill into a chat session.
- Model `skill.get` returns at most 64,000 bytes of body text, with a truncation notice and source
  path for longer procedures. This is separate from the 1 MiB file acceptance limit.

## Related guides

- [Author skills](../extending/skills-authoring.md)
- [Install Claude Code plugins](../extending/claude-code-plugins.md)
- [Learning loop](learning-loop.md)
- [Human-in-the-loop controls](hitl.md)
- [Capabilities](capabilities.md)

## Source of truth

- [Filesystem discovery and scope selection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/skill-discovery.ts)
- [Skill scanning and safety bounds](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/skill-scan.ts)
- [One-shot skill command expansion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/skill-commands.ts)
- [Session pin resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/skills.ts)
- [Runtime prompt injection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/prompt-skills.ts)
- [Keyword triggers](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/prompt-skill-triggers.ts)
- [Pinned bodies](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/prompt-pinned-skills.ts)
- [Model skill access](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/skill.ts)
- [Skill manager operations](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/skill-ops.ts)
- [Curator scheduling and policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/skills-curator/service.ts)
- [Curator filesystem scope and archive moves](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/skills-curator/skill-fs.ts)
- [Web skill-command selection](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/ui/prompt-input/useSkillCommands.tsx)
