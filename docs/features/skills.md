# Reuse procedures with skills

Skills are local `SKILL.md` files that give the agent a named procedure, description, and optional
invocation controls. Use them once with `/name`, pin them to a session, or let the agent load one
when its description matches the task.

**Discovery boundary:** a session reads personal skills (`~/.claude/skills`, `~/.claude/commands`),
then the project's (`.claude/skills`, `.agents/skills`, `.claude/commands`) in the working directory
and every parent up to the repository root. A chat in the **Default** project reads the personal
ones. Your skills are Claude Code's own files: Localix writes `~/.claude/skills` and a project's
`.claude/skills`, and Claude Code loads what it writes.

## What you can do

| Task                       | Mechanism                                                                                            | Boundary                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Run a skill once           | Enter `/name [arguments]` or select it from the web slash menu.                                      | Selection inserts a one-shot command; it does not pin the skill.                         |
| Let the agent run it       | Write `/name` as its own word later in a message (`go ahead and /deploy to staging`).                | Permission for that message, a user-only skill included; the agent decides whether to.   |
| Keep a skill active        | Pin it to the session through the session-skills API.                                                | The full skill body is added to that session's runtime prompt.                           |
| Create or revise a skill   | Use Add skill on Store → Library → Yours (or Project), then edit it on its page.                     | Plugin-bundled skills are read-only; they follow their plugin.                           |
| Let the agent load a skill | The runtime lists names and descriptions; the agent can fetch a matching body with the `Skill` tool. | Bodies are loaded on demand rather than placing every skill in the prompt.               |
| Archive stale skills       | Press **Archive unused** on Yours or Project, check the preview, confirm; or Archive one skill.      | Archived directories are excluded from discovery until restored.                         |
| Deny one agent a skill     | Switch it off on the agent's Store page, **Access** tab.                                             | The switch writes one `skill:<name>` rule; the file and every other agent are untouched. |
| Control availability       | Switch the skill on or off in Store → Installed, or per agent on its **Access** tab.                 | Disabling removes access by name, including pins and keyword triggers; files remain.     |

## How it works

### Terms

| Term             | Meaning                                                   |
| ---------------- | --------------------------------------------------------- |
| Filesystem skill | A directory containing a readable `SKILL.md`.             |
| Project skill    | A skill under `<working-directory>/.claude/skills`.       |
| Personal skill   | A skill under `~/.claude/skills`, used by scratch chats.  |
| Plugin skill     | A read-only skill contributed by an enabled plugin.       |
| Session pin      | A skill name whose full body is injected for one session. |
| Curator pin      | Protection from automatic stale-skill archiving.          |

### Discovery and precedence

| Session scope   | Folders read, in precedence order                                                                                                                                         | Additional source     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Project         | `~/.claude/skills`, `~/.claude/commands`, then in the working directory and each parent up to the repository root: `.claude/skills`, `.agents/skills`, `.claude/commands` | Enabled plugin skills |
| Default project | `~/.claude/skills`, `~/.claude/commands`                                                                                                                                  | Enabled plugin skills |

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
budget: descriptions shorten to bare names before any name is omitted with a notice. The `Skill`
tool can load one body or save a skill; plugin skills can be read but not saved through the tool.
Listing and removing skills belong to the Store. Default delegated workers can also retrieve skills.
An agent's explicit tool list and capability denials still control availability; pinning a skill
supplies its body even without the retrieval tool.

One-shot `/name` invocation expands supported arguments before submitting the prompt. Filesystem
skills can also opt into bounded local command expansion and confined file-reference expansion. A
skill with `context: fork` runs in a child session, typed or loaded by the agent, as the subagent
type its `agent:` names (`Explore`, `Plan`, a plugin agent, or an agent file from `.claude/agents`
or `~/.claude/agents`; the invoking agent by default). Other skills run in the current session.
Child sessions cannot fork skills into more child sessions.

Session pins persist with the session record. The runtime injects each resolvable pinned body under
an active-skills prompt section on subsequent turns, within a shared 32,000-code-unit budget.
Unavailable or unreadable pins are omitted. Agent-profile preloads use the same prompt section.

A skill can declare `keywords` to load its body when a phrase matches the latest non-internal user
message. Matching is case-insensitive, respects word boundaries, and tolerates whitespace within
phrases. These triggers do not inspect tool output. Hiding a skill from the model roster does not
disable its keyword trigger; agent availability rules do.

Slash invocation resolves filesystem skills and enabled plugins' skills (`/<plugin>:<skill>`, or the
bare name when only one plugin has it); a plugin's command files are skills too. The model-facing
`Skill` tool and agent preloads reach the same skills; session pins resolve filesystem skills.

The supported frontmatter, substitution tokens, tool policy, and command-expansion limits belong to
the [skill authoring guide](../extending/skills-authoring.md).

### Management and curation

The Store creates, edits, removes, archives, restores and curator-pins the skills in
`~/.claude/skills` and the open project's `.claude/skills`, the folders Claude Code reads too: **Add
skill** on Library → Yours (yours) or Library → Project (the open project's), and the skill's own
page for the rest. Its Settings tab holds the description and the instructions; **Pin**, **Archive**
and **Restore** are buttons beside them. An edit replaces the managed description and body and
preserves other frontmatter. A skill's name is its identity and is chosen when it is added.

A skill that is stale or close to it says so at the top of its page: "Not used for 95 days. Archived
on 15 Jun 2026 unless pinned." with **Pin** beside it (a project's skill says to use **Archive
unused** instead, since nothing archives it on its own). The page warns within two weeks of the pass
that archives it.

Skills from the portable `.agents/skills`, from command files and from a parent folder's
`.claude/skills` are listed read-only, and say where they live; a plugin's skills follow the plugin.
A `.claude/commands` file is discovered as a skill, so there is no separate commands kind. The
agent's Store page (Access tab) keeps the switches.

`.claude/skills` is shared with Claude Code, whose use of a skill Localix cannot see. So the
scheduled pass and **Archive unused** consider only skills created in Localix (the Store's **Add
skill**, the agent's `Skill` tool, or skills moved from the old `.localix/skills`). A skill Claude
Code or you created by hand there never shows an "archived on" notice and is never archived by
itself; it can still be pinned, archived from its page and restored.

The curator classifies an unpinned skill created in Localix as stale when it has never been used for
more than 30 days or was last used more than 90 days ago. Automatic checks run once the app is idle
after startup and then daily, but an archive pass runs at most once every seven days. The first
automatic observation only saves the schedule marker and waits a full interval before archiving.
When a pass archives skills, one Event Center row names them (one skill: "Archived the review
skill"; more: "Archived 3 unused skills") with **Open to restore**, which opens that skill's page
(or the skills shelf) where **Restore** is.

**Archive unused** on Yours and on Project is the same rule on demand. It first shows a preview,
each skill that would be archived with why ("Last used 100 days ago", "Never used, 45 days old"),
and archives nothing until you confirm. Confirming archives the previewed skills that are still
stale: one you pinned or used meanwhile is left alone. Pinned skills never appear in the preview.

One-shot slash preprocessing and successful `skill.get` record usage on a best-effort basis; they do
not prove that the procedure completed. Pinning and keyword injection do not update this usage
counter. A never-used skill's age comes from its usage record or file modification time.

Curator inventory covers the `.claude/skills` folder of the selected scope, without the runtime's
personal fallback or portable sources. Archiving moves the directory to
`~/.localix/skills-archive/user/<name>` (a project's: `.../<projectId>/<name>`), outside the folders
Claude Code reads, so an archived skill never loads there; restoring moves it back (and refuses when
a folder of that name exists) and records a use. Archiving can replace an archived skill of the same
name.

Curator pins protect automatic passes, but manual archive remains available.

## Configuration

| Setting or surface                   | Effect                                                      |
| ------------------------------------ | ----------------------------------------------------------- |
| `<working-directory>/.claude/skills` | Stores skills for that project scope.                       |
| `~/.claude/skills`                   | Stores skills for scratch chats.                            |
| Agent Store page, Access tab         | Switches skills per agent.                                  |
| Web slash menu                       | Inserts a one-shot `/name` invocation.                      |
| Session-skills API                   | Replaces the session's persisted pinned-skill list.         |
| Agent skill rules                    | Enables or disables access to a named skill for that agent. |

## Limits

- Personal and project skills are merged, personal first, as in Claude Code: a personal skill
  shadows a project skill of the same name.
- Personal `.agents/skills` is not read. Skills in a folder below the working directory are not read
  either; start the session there to use them.
- Skills read from `.agents/skills`, `.claude/commands` and a parent folder's `.claude/skills` are
  read sources: the Store writes, deletes and archives only the open scope's `.claude/skills`.
- Project and plugin symlinks cannot extend discovery outside their safety root; personal skill
  links can. Archived and hidden subdirectories are excluded, and a discovered skill's assets are
  not scanned for nested skills.
- Localix supports a defined `SKILL.md` contract, not every convention used by other tools. Check
  the authoring guide before relying on a field or expansion.
- The web slash menu runs a skill once and the web pinned-skill row can remove existing pins; adding
  a persistent pin is currently exposed only through the session-skills API.
- A skill cannot be renamed in the Store: add the new name and remove the old skill.
- Filesystem skills may execute declared local shell expansions or read confined file references
  during one-shot invocation. Review skill files as executable local instructions.
- Validator warnings are findings, not load blockers. Discovery rejects unreadable files, invalid
  UTF-8, files over 1 MiB, and empty Markdown bodies, including description-only files.
- Automatic curator passes operate on personal skills. Use **Archive unused** on the Project shelf
  for a project's skills.
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
