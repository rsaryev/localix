# Give the agent project instructions

Instruction files tell the agent how a project works: its commands, conventions and the rules for
particular folders. Localix reads the same files Claude Code reads, so a repository set up for
Claude Code gives the agent the same instructions here.

## What you can do

| Task                           | Mechanism                                                                                   | Boundary                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Start a project's instructions | Run `/init`: the agent reads the project and writes `CLAUDE.md`, or improves the one there. | A normal turn; the agent's `Write` asks for approval as usual.      |
| Keep your own preferences      | Write `~/.claude/CLAUDE.md` or `~/.localix/context.md`, and rules in `~/.claude/rules/`.    | Applies to every chat on this machine.                              |
| Share a project's instructions | Commit `CLAUDE.md`, `.claude/CLAUDE.md`, `AGENTS.md` or `.localix/context.md`.              | Read from the working directory and every folder above it.          |
| Keep private project notes     | Write `CLAUDE.local.md` beside the project's `CLAUDE.md` and ignore it in git.              | Read after the folder's `CLAUDE.md`.                                |
| Split instructions by topic    | Put Markdown files in `.claude/rules/` or `.localix/rules/`.                                | A rule without `paths` always applies.                              |
| Scope a rule to some files     | Add `paths:` globs to the rule's frontmatter.                                               | Loads once the agent reads, writes or edits a matching file.        |
| Give a subfolder its own rules | Put a `CLAUDE.md`, `AGENTS.md` or `.claude/rules/` in the subfolder.                        | Loads once the agent works with a file in that subfolder.           |
| Pull in another file           | Write `@path/to/file` in an instruction file.                                               | Up to four levels deep; files outside the project are not imported. |

## How it works

### Load order

| Order | Files                                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `~/.localix/context.md`, `~/.localix/rules/`, `~/.claude/CLAUDE.md`, `~/.claude/rules/`                                                   |
| 2     | Each folder from the filesystem root down to the working directory: `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, then `AGENTS.md` |
| 3     | Inside the repository, each folder's `.claude/rules/`, `.localix/context.md` and `.localix/rules/`                                        |
| 4     | As the work moves: a subfolder's files and the path-scoped rules matching the files worked with                                           |

Nearer instructions come later, so they take precedence within their scope. A folder's `AGENTS.md`
loads after its `CLAUDE.md` files, as Claude Code's `claude-md-and-agents-md` setting reads it; one
that a `CLAUDE.md` already imports with `@AGENTS.md` is not read twice.

Instructions for subfolders and matching files arrive in a separate section of the run's context,
**Instructions for the files in use**, so the project's always-on instructions stay unchanged and
cached.

### Files and frontmatter

- Block-level HTML comments (`<!-- notes for maintainers -->`) are removed before the agent reads a
  file; comments inside code blocks stay.
- `@path` imports resolve relative to the file that holds them. Write a space in a path as `\ `, and
  wrap a path in backticks to mention it without importing it.
- A rule's `paths` takes a YAML list or a comma-separated string of globs, relative to the folder
  that holds the rule's `.claude` or `.localix` folder (to the working directory for your own
  rules). Brace patterns such as `src/**/*.{ts,tsx}` work.
- Rule folders may contain symlinked files and folders that stay inside the project.

## Limits

- An `@path` import of a file outside the project is not inlined; the import is marked instead.
- At most 16 instruction files and 20 rules load, each capped at 20,000 characters, and 60,000
  characters in total.
- Delegated agents of the built-in `Explore` and `Plan` types, and agent files with
  `omitClaudeMd: true`, start without these files.

## Related guides

- [Reuse procedures with skills](skills.md)
- [Install Claude Code plugins](../extending/claude-code-plugins.md)
- [Settings](settings.md)

## Source of truth

- [Instruction file discovery](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/context-files.ts)
- [Files loaded as the work moves](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/context-on-demand.ts)
- [Rule files](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/context-rules.ts)
- [Imports](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/context-imports.ts)
