# Agents in Claude Code's format only

**Status:** proposal.

**Decision:**

- Localix has one agent system: Claude Code's.
- A definition is a Claude Code agent file in Claude Code's own folders.
- Agents are Store items. Settings has no Agents section.
- There is no "human" record. The person is described in `CLAUDE.md`, as in Claude Code.
- Localix's database keeps only what Claude Code has no place for:
  - Access rules
  - a stable identity binding
  - chat history

  All of it is keyed by agent identity and reconciled through the change feed.

## 1. Inventory of today's two systems

### 1.1 Native registry (`localix.agent-definition`, JSON)

- Schema: `packages/agent/src/agents/definition.ts:61-72`; the id is added at `:128`.
- Adapter: `apps/api/src/features/agents/native-format.ts:4-23`.
- Storage: `~/.localix/agents/*.json` and `<project>/.localix/agents/*.json`
  (`agents/discovery.ts:12-13`).

| Native field / behaviour                                                  | Defined                                                                                                                                           | Used by                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` (`native:global:<uuid>`, `native:project:<p>:<uuid>`, `builtin:<h>`) | `registry-identity.ts:2-11`, `definition.ts:132`                                                                                                  | rules per agent (`catalog.ts:68-77`); seats `conversation_participants.agent_id` (`db/types.ts:211`); authorship `agent:<id>` (`db/participant.ts:5-17`); `agent_runs`, `agent_turn_starts`, `usage_events`, `work_records` (`db/types.ts:296,573,431,611`); triggers/loops owner (`db/types.ts:642`, `loops/subsession-runner.ts:126`); config proposals (`config-proposals/contracts.ts:41`); notices (`announce.ts:17-40`) |
| `kind: 'human'`                                                           | `definition.ts:58-100`                                                                                                                            | §4.4                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `handle`                                                                  | `definition.ts:63`                                                                                                                                | `@mentions`; seat handle snapshot; `selectEnabledAgent` (`service.ts:314-328`); delegate `agent:` (`delegate-plugin-agent.ts:96-118`); semantic key (`semantic.ts:16`)                                                                                                                                                                                                                                                        |
| `label`                                                                   | `definition.ts:64`                                                                                                                                | search (`search-provider.ts:34`), semantic (`semantic.ts:34`), UI                                                                                                                                                                                                                                                                                                                                                             |
| `description`, `instructions`                                             | `definition.ts:65-66`                                                                                                                             | `# Agent directory` (`agent-core/prompt/sections/conversation.ts:159-167`), run identity (`run-defaults.ts:6`), semantic body                                                                                                                                                                                                                                                                                                 |
| `leadershipPriority`                                                      | `definition.ts:68`                                                                                                                                | `chat/runtime/conversation-strategy.ts:47`, `run/stages/policy.ts:31`, `run/system-prompt-conversation.ts:81`                                                                                                                                                                                                                                                                                                                 |
| `modelPreference`                                                         | `definition.ts:46-50`                                                                                                                             | `agent-model-defaults.ts:57-76`, `bootstrap/chat-service-deps.ts:264`                                                                                                                                                                                                                                                                                                                                                         |
| `limits.maxTurns`                                                         | `definition.ts:70`                                                                                                                                | `run/turn-limit.ts:12`                                                                                                                                                                                                                                                                                                                                                                                                        |
| `context.preloadSkills`                                                   | `definition.ts:54`                                                                                                                                | `prompt-agent-context.ts:115`                                                                                                                                                                                                                                                                                                                                                                                                 |
| `context.memory.scope`                                                    | `definition.ts:55`                                                                                                                                | `prompt-context.ts:60`, `run/stages/tools.ts:90`, `prompt-agent-context.ts:95`                                                                                                                                                                                                                                                                                                                                                |
| enabled                                                                   | `agent:<id>` rule (`service.ts:132-153`)                                                                                                          | `policy.ts:106-108`, `invocation-service.ts:58-70`                                                                                                                                                                                                                                                                                                                                                                            |
| invocation hosts                                                          | `capabilities/invocation.ts:42-46`                                                                                                                | `invocation-service.ts`, `session-seat.ts:47-60`, `bootstrap/agent-facade.ts:89-104`                                                                                                                                                                                                                                                                                                                                          |
| per-agent ordered rules                                                   | `capability_rule` by agent id                                                                                                                     | `catalog.ts:119-121`; presets `capabilities/builtin-agent-presets.ts:38-91`; copy on create `create-native-agent.ts:11-17,41-44`                                                                                                                                                                                                                                                                                              |
| shipped `localix`, `human`; per-project override, hash, Restore           | `builtin-team.ts:10-43`, `builtin-override.ts`, `catalog.ts:47-53`, `discovery.ts:79-84`, `service.ts:207-211,247-274`                            | Settings                                                                                                                                                                                                                                                                                                                                                                                                                      |
| starter team, seeded once                                                 | `starter-team.ts`, `seed-starter-team.ts`, `bootstrap/agent-facade.ts:75`                                                                         | the person's `~/.localix/agents` (here: 5 files)                                                                                                                                                                                                                                                                                                                                                                              |
| global agents in every project; project shadows                           | `discovery.ts:97-131`                                                                                                                             | `service.ts:83-89`                                                                                                                                                                                                                                                                                                                                                                                                            |
| mini-app agent contributions                                              | `contribution.ts`, `registered-catalog.ts`, `registration-policy.ts`, `seed-bundled-contribution.ts`, `mini-apps/validate-agent-contributions.ts` | no mini app uses them                                                                                                                                                                                                                                                                                                                                                                                                         |
| agent-authored creation                                                   | `authoring.ts:20-157`                                                                                                                             | `agents` tool (`run/agents-options.ts:30-45`)                                                                                                                                                                                                                                                                                                                                                                                 |
| create/edit/delete/copy/reset/enable                                      | `service.ts:106-329`, `routes.ts:62-172`                                                                                                          | Settings → Agents, `/agents` (`chat/service/command-handlers-agents*.ts`)                                                                                                                                                                                                                                                                                                                                                     |
| search, semantic index, change feed                                       | `search-provider.ts`, `semantic.ts`, `bootstrap/semantic-changes.ts:30`, `announce.ts`, `capabilities/changes.ts:25-39`                           | global search, consumers in §6                                                                                                                                                                                                                                                                                                                                                                                                |

### 1.2 Claude Code agents today

- **Agent files outside plugins:** `chat/runtime/file-subagent-types.ts:73-104`.
  - It walks `.claude/agents` from the working directory up to the git root, then
    `~/.claude/agents`.
  - Parsing is `plugins/discovery-cc-files.ts:174-297`, producing `LoadedPluginAgent`
    (`plugins/loader-contract.ts:18-53`).
- **Plugin agents:** named `<plugin>:<name>`.
- **Built-in types:**
  - `Explore` and `Plan`: `run/builtin-subagent-types.ts:16-55`.
  - `general-purpose` and `claude` run as the delegating agent itself:
    `ext/cc-agent-selection.ts:1-9`, `delegate-plugin-agent.ts:91`.
- **A plugin's default `agent`:** `run/plugin-main-agent.ts:19-29`.
- **`memory:` folders:** `run/subagent-file-options.ts:26-66`.

### 1.3 Where the two systems diverge

1. **Two catalogs and two prompt sections.** `# Agent directory` lists registry agents;
   `# Agent types` lists files (`run/plugin-subagent.ts:26-40`). Lookup tries the registry first,
   then files (`delegate-plugin-agent.ts:96-118`).
2. **File agents are second-class.** They are never seated in a chat. They run as the delegating
   agent with its prompt swapped (`plugin-subagent.ts:75-94`). They have no identity, Access,
   enabled switch, search entry or semantic row.
3. **The same idea has different fields.**
   - Model: `modelPreference` vs alias resolution.
   - Memory: `memory.scope` vs `memory:`.
   - Skills: `preloadSkills` vs `skills`.
4. **Two storage roots, neither watched.**
5. **Docs and code disagree on `hooks`.** The compatibility doc says an agent file's `hooks` are
   ignored, but `discovery-cc-files.ts:254-258` activates them.

## 2. Claude Code's agent format (docs; checked against 2.1.310)

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

## 3. Mapping native → Claude Code

| Native                                   | Claude Code / where it goes                                                                       | What is lost, and why it is acceptable                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `handle`                                 | `name`                                                                                            | A `:` becomes `-` on migration                                                                                                                   |
| `description`                            | `description`                                                                                     | Empty becomes `Agent <name>`: Claude Code skips agents without one                                                                               |
| `instructions`                           | body                                                                                              | —                                                                                                                                                |
| `label`                                  | `localix.title`                                                                                   | Cosmetic; kept so titles survive                                                                                                                 |
| `leadershipPriority`                     | `localix.priority` (−2..2, default 0)                                                             | Conversation election is Localix-only                                                                                                            |
| `modelPreference.model`                  | `model` if a Claude alias or id; else `model: inherit` plus `localix.model: "<provider>/<model>"` | A Localix route in `model` would break the file in Claude Code                                                                                   |
| `modelPreference.effort`                 | `effort` (outside Claude Code's set: `localix.effort`)                                            | —                                                                                                                                                |
| `limits.maxTurns`                        | `maxTurns`                                                                                        | Localix also caps seated chat turns                                                                                                              |
| `context.preloadSkills`                  | `skills`                                                                                          | Capped at 32                                                                                                                                     |
| `context.memory.scope`                   | `localix.memoryScope`                                                                             | Different from `memory:` (a folder); both coexist                                                                                                |
| `id`                                     | the binding row (§5), never in the file                                                           | A copied file starts with no permissions; intended                                                                                               |
| enabled, invocation hosts, ordered rules | Access, `capability_rule` by agent id (unchanged)                                                 | The file's `tools`/`disallowedTools` are a ceiling. `Agent(<name>)` denies in the Claude Code settings Localix reads are honoured, never written |
| —                                        | `tools`, `disallowedTools`, `permissionMode`, `color`                                             | Now also applied when the agent is seated in a chat                                                                                              |
| `kind: 'human'`                          | dropped (§4.4)                                                                                    | —                                                                                                                                                |
| shipped override, override hash, Restore | dropped                                                                                           | No shipped agent stays editable                                                                                                                  |
| mini-app agent contributions             | dropped                                                                                           | Agents are a plugin component (X3); unused                                                                                                       |
| creation marks                           | binding row `config.agentCreation`                                                                | Same semantics                                                                                                                                   |

Example file:

```yaml
---
name: architect
description: The shape of the system and the decisions that are expensive to reverse.
model: inherit
localix:
  title: System Architect
  priority: 1
  memoryScope: project
---
You are the system architect. …
```

## 4. Main loop, built-in types, starter team, the person

### 4.1 Main loop

`localix` is the main loop, not an agent file.

- `DEFAULT_AGENT_ID = builtin:localix` stays (`definition.ts:145-147`). Its Access, seats and
  history continue.
- Its identity text moves from `builtin-team.ts:31-32` into `agent-core/prompt`.
- It is read-only in the Store, with an Access tab.
- To customise it, set `"agent"` in the user's or the project's Claude Code settings (honoured
  beyond plugins), or edit CLAUDE.md or the output style.
- Its leader priority of 2 becomes a rule, not data.

### 4.2 Built-in types

- Keep `general-purpose`/`claude`, `Explore` and `Plan`. A file with the same name replaces a
  built-in.
- Do not offer `statusline-setup` or `claude-code-guide`. List them as a known difference.

### 4.3 Starter team

- It becomes the `team` plugin in the `localix` marketplace, Recommended in the Store. This matches
  the Store rule that there are no built-in plugins.
- **Copy to Yours** makes an editable copy.
- Existing seeded members migrate as user files (§7).

### 4.4 The person: dropped

- No `@human` prompt line, no `@human` mention, no profile card, no reserved `human` name.
- `@all` stays: it addresses every participant and is not human-specific.
- The person is described in `~/.claude/CLAUDE.md` or the project's CLAUDE.md, which Localix already
  reads (`agent-core/context-files.ts`).
- Questions to the person still go through `ask` (HITL), which needs no handle.
- Every human-specific code path is listed in §10, part B.

## 5. Identity

Claude Code identifies an agent by (scope, name). Localix needs an id that survives a rename (P10).

- **Binding row.** Reuse `capability_source` with `kind='agent'`.

  | Column       | Holds                                                                |
  | ------------ | -------------------------------------------------------------------- |
  | `id`         | the agent id                                                         |
  | `name`       | the Claude Code name                                                 |
  | `project_id` | `''` for user, managed, plugin and built-in agents; else the project |
  | `source`     | `user`, `project`, `managed`, `plugin:<plugin>@<mkt>` or `builtin`   |
  | `config`     | `{ path, bodyHash, missingSince?, agentCreation? }`                  |

- **New ids** look like `cc:<uuid>`. Migrated agents keep their `native:*` id.
- **Precedence** follows Claude Code. A shadowed definition keeps its row and is labelled "shadowed
  by …".
- **Rename detection**, on one settled scan:

  | What changed                                       | Treated as                                                 |
  | -------------------------------------------------- | ---------------------------------------------------------- |
  | Same path, new `name`                              | Rename                                                     |
  | A vanished path and a new one, same scope and name | Move: only the path updates                                |
  | New path and new name, same body hash              | Rename                                                     |
  | Anything else                                      | Delete and create                                          |
  | Cross-scope move                                   | New identity, unless Localix's own **Move** action made it |

- **History** keeps `agent:<id>` authorship and the seat's handle snapshot. A removed agent's
  messages show its last name, marked "(removed)".

## 6. Lifecycle and cleanup

**Watching.** `features/agents` watches every folder it reads with `fs-watch/path-watch.ts:22`:

- `~/.claude/agents`
- the managed folder
- each known project's `.claude/agents` chain

It also follows `plugin` notices.

**Announcing.** It settles each burst (like `capabilities/changes.ts:22`), rescans and diffs against
the binding rows. Each notice is recorded in the same transaction as the row (C1):

- `upserted`: a new, changed or renamed agent. A rename is the old key `deleted` plus the new key
  `upserted`, both with the same id.
- `deleted`: only on purge.
- `resync`: at start and after a watcher error or overflow.

**A vanished file is "missing", not deleted.**

- It leaves every list and the prompt at once.
- If it reappears within the grace window, it keeps its id.
- Grace: 7 days for project scope, 10 minutes for user and managed scope.
- A delete in the Store or `/agents` purges at once.
- Uninstalling a plugin purges its agents.
- A disabled plugin or a missing project folder is never a deletion.

**What each consumer does:**

| Consumer                                               | Where                                                                               | On purge                                                                                                                                                  | On rename               | On resync                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------- |
| Seats, session model choices, per-agent model settings | `chat/agent-seats/agent-seats.ts:35-44,67`; `bootstrap/core-reactors.ts:113-133`    | `leaveRooms`, `forgetChoices`, `forgetModelSettings` (these exist)                                                                                        | handle snapshot follows | handles; add: leave rooms of ids with no row |
| Access rules                                           | inline today (`agents/service.ts:242`); `capabilities/cleanup.ts:97` ignores agents | **new:** empty the agent's list; drop `capability_policy_revision`/`_binding`; strip `agent:<id>` and `invocation:*` resources naming it from other lists | —                       | drop lists of ids with no row                |
| Semantic index                                         | `bootstrap/semantic-changes.ts:30`, `agents/semantic.ts:14-38`                      | remove the key                                                                                                                                            | re-key                  | rebuild                                      |
| Store index                                            | `bootstrap/store.ts`                                                                | listing removed                                                                                                                                           | re-keyed                | rebuild                                      |
| Realtime relay                                         | `realtime/relay.ts:84`                                                              | poke `agents`, `sessions`                                                                                                                                 | same                    | poke                                         |
| Mini-app deletion followers                            | `changes/core-deletions.ts:24-27`, `mini-apps/kanban/backend/unassign.ts:46`        | passed on unless `agentLivesOn`                                                                                                                           | not passed              | —                                            |
| Loops and triggers owned by the agent                  | `db/types.ts:642`, `loops/subsession-runner.ts:111-126`                             | **new:** stop them, keep records, notify the session                                                                                                      | —                       | stop orphans                                 |
| Pending config proposals                               | `config-proposals/contracts.ts:41`                                                  | **new:** discard                                                                                                                                          | —                       | discard orphans                              |

**Never deleted:**

- messages and their authorship
- `agent_runs`, `agent_turn_starts`, `usage_events`, `work_records`, `participant_lane_snapshots`
- the seat handle snapshot in transcripts
- `memory:` folders (they belong to Claude Code)

## 7. No migration (beta)

Localix is in beta with almost no users, so there is no compatibility layer: no JSON→Markdown
converter, no `native:*` id binding, no backup folder, no banner.

- The native registry (`~/.localix/agents/*.json`, `.localix/agents/*.json`) and its adapter are
  deleted with the code that reads them.
- Rules, seats and history keyed by a `native:*` id are dropped by the consumer cleanup of §6; an
  agent a person wants to keep is recreated as a Claude Code file (the starter team of §4.3 ships as
  plugin files, so most people lose nothing).
- Human records are dropped with the feature (§4.4); nothing offers to copy them into `CLAUDE.md`.
- A migration is added only if a later change would cost a person real data.

## 8. Agents in the Store (Settings → Agents is deleted)

### Provider

- The agents owner implements `StoreProvider` with `kind: 'agent'`
  (`packages/store/src/provider.ts:35-62`), wired in `bootstrap/store.ts` (A4).
- Its listings are derived from the bindings and files (P9).
- `subscribe` fires on `agent` notices.

| Group          | Source                                                             | Editable | Actions                                                       |
| -------------- | ------------------------------------------------------------------ | -------- | ------------------------------------------------------------- |
| Yours, user    | `~/.claude/agents`                                                 | yes      | Edit, Duplicate, Move to project, Delete, enable switch       |
| Yours, project | open project's `.claude/agents` chain                              | yes      | Edit, Duplicate, Move to user, Delete, enable switch          |
| Managed        | managed folder                                                     | no       | Copy to Yours, enable switch                                  |
| From plugins   | enabled plugins' `agents/` (also components of the plugin listing) | no       | Copy to Yours, enable switch; removal is the plugin's         |
| Built in       | `localix`, `general-purpose`, `Explore`, `Plan`                    | no       | enable switch (never for `localix`, `disable-guard.ts:20-35`) |

- Library → Yours shows the first two groups. Capabilities → Agents shows all of them.
- `install`, `update` and `plan` are absent. Standalone agents from registries are Store step 5.
- `remove` = delete, with confirmation when the agent is seated in a chat.
- `setEnabled` writes the `agent:<id>` rule.
- `facts` show the scope, the path, "shadowed by …" and missing/unavailable.

### Agent page

The contract gains `ListingDetail.tabs?: ('definition' | 'access')[]` and `ListingDetail.form`. The
page reuses `StoreDetail`, and `DetailTabs.tsx:12` grows the extra tabs without naming a provider.

1. **Overview:** description, title, colour, a body preview, location, usage (N chats, N loops),
   Duplicate, Copy to Yours, Delete, Open file.
2. **Definition** (editable agents only):
   - **Frontmatter** is edited with a new generic, schema-driven form (`packages/kit` `SchemaForm`;
     field kinds: text, multiline, enum, number, boolean, tags, model picker).
     - Claude Code fields: `name`, `description`, `tools`, `disallowedTools`, `model`, `effort`,
       `permissionMode`, `maxTurns`, `skills`, `memory`, `background`, `isolation`, `omitClaudeMd`,
       `color`, `autoCompactWindow`.
     - A "Localix" group: `localix.title`, `priority`, `model`, `memoryScope`.
   - `hooks`, `mcpServers`, `experimental` and unknown keys are kept verbatim and shown as read-only
     YAML, with "Edit in file".
   - **The body** uses our Markdown editor.
   - **Save:** `POST /rpc/store/agent/:id/definition` with `{ frontmatter, body, expectedHash }`.
     - The YAML writer preserves unknown keys, their order and comments.
     - The file is written staged, then renamed.
     - A stale hash gets a conflict reply with Reload or Overwrite.
     - The watcher picks up the change: there is one write path.
3. **Access:**
   - Per-agent switches for tools, skills, MCP servers and their tools, plugins, mini apps and
     invocation hosts.
   - Moved from `settings/ui/agent-profile/AgentCapabilityPanel.tsx`; it writes through the existing
     apply service (`bootstrap/capability-services.ts:190-215`).
   - The file's `tools`/`disallowedTools` show as a locked ceiling.
4. **Permissions:**
   - The agent's ordered allow/ask/deny rules.
   - The Claude Code settings rules that apply (`Agent(<name>)` and global rules) appear read-only
     above them.
   - For a plugin agent, the plan of what it runs comes first.

### Where state lives

`capability_rule`, `capability_policy_revision` and `capability_source` (the binding), keyed by
agent id. None of it is written to the file, and §6 cleans it up.

### New agent (Library → Yours, `/agents create`)

1. A dialog takes name, scope and description. A name already taken in that scope is refused.
2. The owner reserves `cc:<uuid>` and its row, then writes the starting Access before the file
   exists:
   - `inheritedAgentPreset`, or
   - the creating agent's rules, for agent-authored creation (`create-native-agent.ts:41-44`).
3. It writes `<scope>/.claude/agents/<name>.md` with `name`, `description`, `model: inherit` and a
   placeholder body.
4. It records `upserted` in the same transaction as the row.
5. The Store opens the Definition tab.

### Other surfaces

- `/agents edit`, `permissions` and `create` open the Store page.
- `@` autocomplete and the add-participant menu read the same catalog.
- Search hits open `localix://ui/work-item/store?kind=agent&id=<id>` (replacing
  `search-provider.ts:32`).
- Old `settings/agents/…` addresses redirect to the Store.

## 9. Implementation order (tests first)

0. **Black-box check.** In a scratch folder, write `.claude/agents/x.md` containing
   `localix: {priority: 1}`, then run `claude --debug -p "list your subagent types"`. `x` should be
   listed, and the debug log should name only `localix`. Record the result in the compatibility doc.
1. **One catalog in `features/agents`.** Tests for precedence, shadowing and `localix:` validation.
   `plugins/validate-fields.ts` accepts the `localix` key. `file-subagent-types.ts` moves in.
2. **Binding rows and the watcher.** Tests inject watcher events and the clock (no sleeps). Cover:
   - create, edit, rename by path, move, rename by hash
   - missing → grace → purge, and return within grace
   - a disabled plugin is not a deletion
   - every notice is written in the row's transaction
3. **Consumers.** C4 tests (duplicate, gap with resync, delete) for capability cleanup, loops and
   triggers, and config proposals. Extend the seats reconcile and re-key the semantic index.
4. **Runtime unification.** Prompt and golden tests:
   - one `# Agent directory`
   - file agents seated with their tools
   - priority from `localix.priority`, and `localix.memoryScope`
   - `permissionMode` is applied
   - an `Agent(name)` deny hides the agent
5. **Main loop and removing the person.**
   - Move `localix`'s text into the prompt; honour the settings `agent` key.
   - Delete the human paths (§10, part B).
   - Goldens change: write the golden that has no `@human` line first, and see it fail.
6. **Store provider.** Contract changes (`tabs`, `form`). Tests: groups, read-only agents,
   `setEnabled`, saving with `expectedHash`, a lossless YAML round-trip.
7. **Store UI.** DOM tests:
   - a Definition edit reaches the file, the watcher and the page
   - Access toggles write rules only
   - New agent writes the file and opens Definition

   Plus a screenshot scenario.

8. **Migration (§7).** Tests: idempotence, conflicts, backup, ids kept, project consent, the "About
   me" offer (yes, no, empty), a crash between files.
9. **Remove Settings → Agents.** Redirect old addresses; repoint `/agents` and the `agents` tool.
10. **Starter team plugin.** Publish the `team` plugin; delete the seed.
11. **Docs.**
    - `docs/features/agents.md`, `agent-management.md`, delegation's "Claude Code agent types".
    - The compatibility table, including the `hooks` fix and dropping the human.
    - The Store doc and the changelog.

## 10. Cleanup list for the agents area

Actions: **D** = delete, **S** = replace with the one shared implementation named, **K** = keep.

### A. Native registry and storage

| Item                                                                       | Where                                                                                                                                                                                     | Action                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| JSON format and adapter                                                    | `agents/native-format.ts`                                                                                                                                                                 | D (survives only inside the migration)                                 |
| JSON writer, remove-by-handle                                              | `agents/registry-files.ts`                                                                                                                                                                | S → `agent-file-writer` (staged Markdown, YAML-preserving)             |
| Native id prefixes, `belongsToNativeScope`, `visibleInScope`               | `agents/registry-identity.ts:2-18`; used at `invocation-service.ts:85,108,126,145,170`, `service.ts:309`                                                                                  | D; scope comes from the binding row                                    |
| Shipped records, kit, override hash                                        | `builtin.ts`, `builtin-kit.ts`, `builtin-team.ts`, `builtin-override.ts`                                                                                                                  | D (the `localix` text moves to `agent-core/prompt`)                    |
| Native discovery and precedence walk                                       | `discovery.ts:12-145`                                                                                                                                                                     | S → one Claude Code catalog                                            |
| Claude Code file walk and precedence                                       | `chat/runtime/file-subagent-types.ts:23-104`                                                                                                                                              | S → same catalog                                                       |
| Private Markdown tree walker                                               | `file-subagent-types.ts:23-47`                                                                                                                                                            | S → `plugins/discovery-cc-markdown-scan.ts:172` `collectMarkdownFiles` |
| Double frontmatter parse (name/description checked, then `parseAgentFile`) | `file-subagent-types.ts:52-57`                                                                                                                                                            | D; `parseAgentFile` alone decides                                      |
| Built-ins merged by name                                                   | `run/builtin-subagent-types.ts:49-55`                                                                                                                                                     | S → catalog precedence                                                 |
| Catalog with registrations, override approvals, human                      | `catalog.ts:23-125`                                                                                                                                                                       | S → catalog plus Access snapshot                                       |
| Mini-app agent contributions                                               | `contribution.ts`, `registered-catalog.ts`, `registration-policy.ts`, `seed-bundled-contribution.ts`, `mini-apps/validate-agent-contributions.ts`, `bootstrap/domain-services.ts:184-185` | D                                                                      |
| `capability_policy_binding` for agents                                     | `registration-policy.ts:100-177`                                                                                                                                                          | D (table stays if other kinds use it; else a drop migration)           |
| Starter team and seed                                                      | `starter-team.ts`, `seed-starter-team.ts`, `bootstrap/agent-facade.ts:72-85`                                                                                                              | D → `team` plugin                                                      |
| Reserved-handle relocation                                                 | `reserved-handle-rename.ts`                                                                                                                                                               | D                                                                      |
| Trust class from "builtin"                                                 | `summary.ts:24-25`                                                                                                                                                                        | S → binding `source`                                                   |
| Field policy (`FIELD_KEYS`, `lockedChanges`, `agentPolicy`)                | `policy.ts:16-124`                                                                                                                                                                        | S → one `editable` flag by source; keep `canJoinConversation`          |
| Reset, defaults, override paths                                            | `service.ts:207-211,247-274`; routes `/:name/defaults`, reset                                                                                                                             | D                                                                      |
| `run-defaults.ts`                                                          | `run-defaults.ts:4-13`                                                                                                                                                                    | S → catalog agent's run options                                        |
| Create path                                                                | `create-native-agent.ts`                                                                                                                                                                  | S → owner's `createAgentFile` (keeps `copyAgentPolicy` `:11-17`)       |
| Announcer outside a transaction                                            | `announce.ts:8-43`                                                                                                                                                                        | S → notices recorded with the binding row (C1)                         |
| Duplicate `DEFAULT_AGENT_HANDLE` / `DEFAULT_AGENT_ID` constants            | `db/participant.ts:34-35` and `packages/agent/src/agents/definition.ts:145-147`                                                                                                           | S → the package's constants only                                       |

### B. The person (human)

| Item                                                                                                                                                            | Where                                                                                                                                                                                                                                         | Action                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HUMAN_HANDLE`, `HUMAN_PROFILE_MAX_CHARS`, `HUMAN_AGENT_ID`, `isHumanAgent`, `AgentKind`, `kind` field, `checkKind` human branch, `human` in `RESERVED_HANDLES` | `packages/agent/src/agents/definition.ts:7-15,25-29,58-100,149-152`                                                                                                                                                                           | D (`ALL_MENTION_HANDLE` stays reserved)                                                                                                                                          |
| Human record                                                                                                                                                    | `agents/builtin-team.ts:34-42`                                                                                                                                                                                                                | D                                                                                                                                                                                |
| Human in catalog and service                                                                                                                                    | `catalog.ts:26-27,58-67,118`; `service.ts:70-71,116-118`; `service-contract.ts:46-47`                                                                                                                                                         | D                                                                                                                                                                                |
| Human filters in discovery                                                                                                                                      | `discovery.ts:85-86,120`                                                                                                                                                                                                                      | D                                                                                                                                                                                |
| Human field policy                                                                                                                                              | `policy.ts:59-66,71`                                                                                                                                                                                                                          | D                                                                                                                                                                                |
| Contribution refinement                                                                                                                                         | `contribution.ts:7-10`                                                                                                                                                                                                                        | D (file goes)                                                                                                                                                                    |
| `resolveHuman` port                                                                                                                                             | `bootstrap/agent-directory-ports.ts:42-49`; `bootstrap/domain-services.ts:234`; `bootstrap/mini-app-host-refs.ts:33`; `chat/service/context.ts:216-217`; `chat/service/service-graph.ts:159`; `chat/runtime/agent-runner-types.ts:37,238-239` | D                                                                                                                                                                                |
| Fetching the profile per turn                                                                                                                                   | `chat/runtime/run/stages/context.ts:46-52,245`                                                                                                                                                                                                | D                                                                                                                                                                                |
| Prompt `@human` entry and `HumanProfile`                                                                                                                        | `agent-core/prompt/sections/conversation.ts:27,110-134`; `agent-core/prompt/contracts.ts:6,75-76,85`; `run/system-prompt-conversation.ts:13,18-19,39`; `run/system-prompt-build.ts:40,82-83`                                                  | D; regenerate `agent-core/prompt/__golden__/*.txt`                                                                                                                               |
| Board line naming `@human`                                                                                                                                      | `agent-core/prompt/sections/team-contract.ts:19-30`; `sections/conversation.ts:4,74`                                                                                                                                                          | S → "a card assigned to the person waits for them" (open question 5)                                                                                                             |
| Mention filter for `human`                                                                                                                                      | `chat/agent-mentions.ts:16-18,120,155-158`                                                                                                                                                                                                    | D (keep `ALL_MENTION_HANDLE`)                                                                                                                                                    |
| Handoff to the user with a `human` snapshot                                                                                                                     | `chat/runtime/message-persistence.ts:170` (handoff path)                                                                                                                                                                                      | S → `to: USER_PARTICIPANT` with no handle snapshot                                                                                                                               |
| Session selection guard                                                                                                                                         | `chat/service/session-agent-selection.ts:2,42-46`                                                                                                                                                                                             | D                                                                                                                                                                                |
| Mini-app directory person entry                                                                                                                                 | `mini-apps/agent-directory.ts:2,13,27-31,50-62`; `bootstrap/mini-app-agent-directory.ts:28`; SDK `packages/mini-app-sdk/src/backend/context.ts:111-114` (`kind: 'human'`)                                                                     | D (SDK major change); kanban keeps `HUMAN_ASSIGNEE_ID='user'` (`mini-apps/kanban/shared/rules.ts:141-150`) with the label "you", no `@human` (`kanban/backend/tools.ts:133-134`) |
| Notifying the person of an assigned card                                                                                                                        | `chat/runtime/run/human-assignment.ts`                                                                                                                                                                                                        | K (keyed by `user`, not a handle); update comments                                                                                                                               |
| UI                                                                                                                                                              | `settings/ui/capabilities/HumanAgentCard.tsx` (183 lines) and its test; `settings/ui/AgentsSettings.tsx:8,63`; `shared/contrib/humanProfile.ts`; `entities/chat/ui/prompt-input/model-select/participantRows.ts:1,69`                         | D                                                                                                                                                                                |
| Tests                                                                                                                                                           | `agents/human-record.test.ts`, `reserved-handle-rename.test.ts`, the human cases in `discovery.test.ts`, `definition.test.ts`, `HumanAgentCard.dom.test.tsx`                                                                                  | D                                                                                                                                                                                |
| Stale build output                                                                                                                                              | `apps/api/dist/**`, `packages/agent/dist/**`                                                                                                                                                                                                  | not source; confirm it is gitignored                                                                                                                                             |

### C. Duplicate heuristics that redo Claude Code's own rules

| Heuristic                                                               | Where                                                                                                                                                                                            | Action                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Name matching (exact, bare, `@`-prefix, lower-case, ambiguity)          | `delegate-plugin-agent.ts:68-81`; `run/plugin-subagent.ts:86-88`; `agents/service.ts:65-89,314-328`                                                                                              | S → `catalog.resolve(name, scope)` in the owner, following Claude Code's precedence                     |
| Self-type set `general-purpose`/`claude`                                | `ext/cc-agent-selection.ts:1-9` and `delegate-plugin-agent.ts:91`                                                                                                                                | S → one constant in the catalog (built-in types)                                                        |
| Registry-first, then plugin-type lookup                                 | `delegate-plugin-agent.ts:96-118`                                                                                                                                                                | D; one lookup                                                                                           |
| Model resolution in three shapes                                        | `agents/agent-model-defaults.ts:57-76` (provider prefix); `agent-core/tools/workflow/agent-route.ts:29` and `delegate-plugin-agent.ts:161-176` (aliases); `run/plugin-main-agent-model.ts:18-27` | S → one `agentModelRoute(agent)` over `agent-core/model-alias` `resolveModelAlias` plus `localix.model` |
| Tool ceiling from a Claude Code agent                                   | `run/plugin-main-agent.ts:35-49` (`runAsPluginAgent`) and the separate `disallowedTools` in `builtin-subagent-types.ts:14`                                                                       | S → one `agentToolCeiling(agent)`, used when seated, delegated and as main loop                         |
| Two prompt sections listing agents                                      | `run/plugin-subagent.ts:19-40` and `agent-core/prompt/sections/conversation.ts:159-167`                                                                                                          | S → one `# Agent directory`; `AGENT_TYPES_HEADING` goes                                                 |
| Plugin-only main-agent rule (`speakerAgentId === DEFAULT_AGENT_ID`)     | `run/plugin-main-agent.ts:19-29`                                                                                                                                                                 | S → the settings `agent` key from user, project or plugin, in Claude Code's order                       |
| `memory:` folder handling                                               | `run/subagent-file-options.ts`                                                                                                                                                                   | K (Claude Code's own rule, now for every agent)                                                         |
| `skill-fork` `agent:` handling                                          | `command-handlers-skill.ts:203`                                                                                                                                                                  | S → `catalog.resolve`                                                                                   |
| Seat resolution via registry `selectEnabledAgent`/`resolveEnabledAgent` | `agents/session-seat.ts:47-60`, `service.ts:305-328`                                                                                                                                             | S → catalog plus Access                                                                                 |

### D. UI, Settings → Agents

| File                                                                                                                                                                    | Lines | Action                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------ |
| `settings/ui/AgentsSettings.tsx`                                                                                                                                        | 80    | D                                    |
| `capabilities/AgentRow.tsx`                                                                                                                                             | 146   | D                                    |
| `capabilities/agent-editor/*` (`AgentEditor`, `AgentIdentityFields`, `AgentModelField`, `AgentContextFields`, `agentDraft`, `useAgentEditorForm`, `agentEffortOptions`) | ≈830  | D (the Definition tab replaces them) |
| `agent-profile/AgentProfileTab.tsx`, `.surface.ts`, `agentProvenance.ts`                                                                                                | ≈340  | D                                    |
| `agent-profile/AgentCapabilityPanel.tsx`                                                                                                                                | 81    | K → moves into the Store Access tab  |
| Settings nav entry; `widgets/editor-grid/ui/registry.tsx` agent entry; agent client calls for reset and defaults (`shared/api/agents-client.ts`)                        | —     | D, with a redirect                   |

Size estimate: about 3,000 product lines go (API ≈1,300, UI ≈1,600, human paths ≈150). About 900
come in (watcher and bindings, migration, provider, `SchemaForm`, Definition tab, shared resolvers).
The net is clearly negative for the code budget.

## 11. Risks

- **External deletes are destructive.** Git checkouts and sync tools can remove files; the grace
  window protects against them. A short project grace would drop Access.
- **Claude Code sees Localix agents.** After migration they appear in the person's Claude Code too;
  the notice says so. `model: inherit` keeps non-Anthropic routes out of Claude Code.
- **Losing the human line changes prompts for everyone.** Someone who kept notes there loses them
  unless they accept the CLAUDE.md offer.
- **Breaking SDK change.** Mini apps that read `kind: 'human'` break; kanban is the only known one.
- **Git noise:** agent-authored project specialists show up in git.
- **Watcher gaps:** covered by `resync` at start and on errors, plus a periodic reconcile.
- **Lossless YAML round-trip** on Definition saves.
- **People will look for agents in Settings.** Keep a redirect.

## 12. Decisions (formerly open questions)

1. **Grace window:** 30 s for a file that disappears and reappears (git checkout, sync tools); the
   purge runs after it, through the change feed.
2. **Default scope for agent-created specialists:** user (`~/.claude/agents`); a project agent only
   when the person chooses "This project".
3. **`localix.title`:** dropped; the Store shows `name` and the first line of `description`.
4. **Disabling an agent:** Access only; Localix never writes `Agent(name)` into Claude Code
   settings.
5. **Board cards for the person:** dropped with the human; an unassigned card is the person's.

## 13. Heuristics leave the core (Store primitives)

The core keeps mechanisms (run a loop, enforce a ceiling, announce a change). Everything that
decides which package, agent, skill or tool applies is resolved by one owner that the Store lists:

- **One resolver per primitive** (`catalog.resolve` for agents, the skill catalog for skills, the
  tool registry for tools). Chat, delegation, loops and slash commands call it; none re-implements
  name matching, precedence or alias handling (§10 C).
- **No built-in names in core code.** Built-in types (`general-purpose`, `Explore`, …) are catalog
  entries with a `builtin` source, not constants spread over prompt and delegate code.
- **Defaults come from packages.** Recommended and starter agents, skills and mods ship as
  marketplace plugins offered in the Store, never seeded or special-cased in the core.
- **Ceilings and models are data on the item** (`tools`, `disallowedTools`, `model`, `localix.*`),
  read through one function each.
- Each removal is a TDD step: a test at the person's layer first, then the deletion.

### Critical Files for Implementation

- /Users/okak/Documents/localix/apps/api/src/features/agents/service.ts
- /Users/okak/Documents/localix/apps/api/src/features/chat/runtime/file-subagent-types.ts
- /Users/okak/Documents/localix/apps/api/src/features/agent-core/tools/delegate-plugin-agent.ts
- /Users/okak/Documents/localix/packages/store/src/provider.ts
- /Users/okak/Documents/localix/apps/api/src/features/agent-core/prompt/sections/conversation.ts
