# Agents in Claude Code's format only

**Status:** implemented.

**Decision:**

- Localix has one agent system: Claude Code's.
- A definition is a Claude Code agent file in Claude Code's own folders: `~/.claude/agents`, a
  project's `.claude/agents`, the managed folder, or a plugin's `agents/`.
- Agents are Store items (the Agents shelf, an agent's page). Settings has no Agents section.
- There is no "human" record. The person is described in `CLAUDE.md`, as in Claude Code.
- Localix's database keeps only what Claude Code has no place for: Access rules, a stable identity
  binding and chat history. All of it is keyed by agent identity and reconciled through the change
  feed.
- The starter team (architect, backend, frontend, design, devops) is the `team` plugin of the
  `localix` marketplace, recommended in the Store. Nothing is seeded into a profile.
- Mini apps do not contribute agents; an agent shipped with software is a plugin component (X3).

## Claude Code's agent format (docs; checked against 2.1.310)

Source: https://code.claude.com/docs/en/sub-agents.md

**File shape.**

- Markdown with YAML frontmatter; the body is the system prompt.
- Required:
  - `name`: at most 256 characters, no `:`, not starting with `-`; it need not match the filename.
  - `description`.

**Optional keys:**

| Key                                           | Values and behaviour                                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools`, `disallowedTools`                    | tool lists                                                                                                                                                                                     |
| `model`                                       | `sonnet`, `opus`, `haiku`, `fable`, a full id, or `inherit`                                                                                                                                    |
| `permissionMode`                              | `default`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`, `manual`                                                                                                             |
| `maxTurns`, `autoCompactWindow`               | limits                                                                                                                                                                                         |
| `skills`                                      | preloaded at start, first 32                                                                                                                                                                   |
| `mcpServers`, `hooks`                         | MCP servers and hooks for this agent                                                                                                                                                           |
| `memory`                                      | `user`, `project` or `local`, mapping to `~/.claude/agent-memory/<n>/`, `.claude/agent-memory/<n>/`, `.claude/agent-memory-local/<n>/`; the first 200 lines or 25 KB of `MEMORY.md` are loaded |
| `background`, `omitClaudeMd`, `initialPrompt` | run behaviour                                                                                                                                                                                  |
| `effort`                                      | `low` to `max`                                                                                                                                                                                 |
| `isolation`                                   | `worktree`                                                                                                                                                                                     |
| `color`                                       | one of 8 names                                                                                                                                                                                 |
| `experimental.cacheTtl`                       | prompt-cache lifetime                                                                                                                                                                          |

**Rules that matter here.**

- Plugin agents ignore `permissionMode`, `mcpServers`, `hooks` and `initialPrompt`.
- **Unknown keys are ignored without an error.** `claude --debug` logs
  `does not recognize or apply`. That makes room for a namespaced `localix:` key. The marketplace's
  `metadata.localix` already relies on the same behaviour (`docs/internals/store.md`).
- **Precedence**, highest first:
  1. managed `.claude/agents/`
  2. `--agents` JSON
  3. project `.claude/agents/`, walking up; the closest one wins
  4. `~/.claude/agents/`
  5. plugin `agents/` (`<plugin>:<sub>:<name>`)
- Subfolders don't change an agent's identity, except inside plugins.
- Two agents with the same name in one folder tree: one loads, by read order.

**Built-in types:** `Explore`, `Plan` (both read-only, without CLAUDE.md), `general-purpose`,
`claude`, `statusline-setup`, `claude-code-guide`.

**Use and control.**

- Ways to invoke an agent: by its description, by natural language, `@agent-<name>`, or `--agent` /
  settings `"agent"`.
- Subagents can nest 3 levels deep.
- Disable one with `permissions.deny: ["Agent(<name>)"]`.
- Agent folders are watched live.
- `/agents` only points at the folders now.

**Identity.** There is no stable agent id and no "human" concept. The person writes about themselves
in `CLAUDE.md`.

## How it is built

**Main loop and built-in types.** `localix` is the main loop, not a file: it is read-only in the
Store with an Access tab, and a user or project Claude Code setting `"agent"` customises it. The
built-in types `general-purpose`/`claude`, `Explore` and `Plan` are catalog entries; a file with the
same name replaces one. `statusline-setup` and `claude-code-guide` are not offered.

**Identity.** Claude Code identifies an agent by scope and name; Localix needs an id that survives a
rename. A binding row (`capability_source`, `kind='agent'`,
`apps/api/src/features/agents/bindings/`) holds the id (`cc:<uuid>`, or `builtin:<name>`), the name,
the project, the source and the file's path and body hash. A rename on one settled scan (same path
with a new name, a moved path, or the same body hash) keeps the id; a copied file starts with no
permissions. Precedence follows Claude Code, and a shadowed definition keeps its row.

**Lifecycle.** The agents owner watches every folder it reads, settles each burst, rescans and diffs
against the binding rows, and records each change notice in the same transaction as the row. A
vanished file is "missing", not deleted: it leaves every list and the prompt at once, and keeps its
id if it reappears within 30 seconds (`GRACE_MS`). A delete in the Store or `/agents`, or removing a
plugin, purges at once. On a purge consumers clean up after their own data: seats and model choices,
Access rules, the semantic and Store indexes, the realtime relay, mini app followers, loops and
pending config proposals. Messages, runs, usage and the seat-handle snapshot in transcripts are
never deleted, and `memory:` folders belong to Claude Code.

**In the Store.** The agents owner is the `agent` `StoreProvider` (`agents/store-provider.ts`),
wired in `bootstrap/store.ts`. Yours lists the user's and the open project's files, which can be
edited, duplicated, moved between scopes and deleted; managed, plugin and built-in agents are
read-only with **Copy to Yours**. An agent's page has Overview, a Settings tab (name, description
and instructions; a save against a changed file asks to reload) and an **Access** tab with the
per-agent switches for tools, skills, MCP servers, plugins and mini apps. Tool permission rules are
in Settings → Permissions. `/agents create` opens the shelf or has the agent draft a specialist, and
search hits open `localix://ui/work-item/store?kind=agent&id=<id>`.

**Decisions.**

- Disabling an agent is Access only; Localix never writes `Agent(name)` into Claude Code settings.
- Agent-created specialists go to the user scope unless the person chooses "This project".
- `localix.title` is dropped: the Store shows `name` and the first line of `description`.
- A `localix:` frontmatter key keeps what Claude Code has no field for (`priority`, `memoryScope`, a
  non-Claude model route with `model: inherit`); Claude Code ignores unknown keys.
- There is no migration: the native registry and the human record were removed with their code.

**Heuristics stay out of the core.** The core keeps mechanisms (run a loop, enforce a ceiling,
announce a change). One owner resolves each primitive (`catalog.resolve` for agents, the skill
catalog, the tool registry) and chat, delegation, loops and slash commands call it. No built-in
names are scattered through core code, and defaults come from packages, never from seeding.
