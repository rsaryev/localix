# Know the tool roster

The tool roster is the set of model-facing tools a run places on each model request. Every schema on
the wire is paid before the first token of conversation, so the roster is deliberately small: the
edit-and-verify loop rides by default, everything rarely reached is one `activate_tools` call away.

**Effect and coverage:** The schemas a fully composed chat carries measure about 6,600 tokens per
request (22 tools, counted from the real factories); the whole fixed floor was 16,600 before the
reshape. `context_budget` reports the breakdown to the model, and a ratchet test pins the schema
budget.

## What you can do

| Action                        | Mechanism                                                                                  | Availability and boundary                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| See the roster of a session   | Ask the agent, or read the scope's rules in **Settings → Capabilities → Tools**.           | The composer's budget pill counts what the next request carries.                  |
| Remove a tool from later runs | Add a `tool:<name>` rule with effect `deny` for the scope in Settings → Capabilities.      | Applies to the next run; see [Manage the tool budget](tool-budget.md).            |
| Reach a deferred tool         | The model calls `activate_tools` with the exact name.                                      | The activation is remembered on the session and survives a context checkpoint.    |
| Use an open plugin's tools    | Link the plugin's tab to the message (open tabs link by default), or let it wake the chat. | On the wire for that turn only; a closed tab or a removed chip brings none.       |
| Learn why a tool is missing   | Ask the agent; it reads the run's ledger through `configure` with `action: "inspect"`.     | Read-only. A switched-off tool also names the change that restores it.            |
| Wait for something external   | `bash` with `until: <seconds>` polls the command and wakes the session when it exits 0.    | Needs a manageable job (`jobs` present); see [Wait for something](monitors.md).   |
| Plan before building          | The Kanban plugin's `kanban` tool: put the work on the chat's board before starting.       | A deferred plugin tool on a passive board; see the [Kanban guide](task-board.md). |

## How it works

### Read tool inputs and results

Expand a tool call in the conversation to inspect its input and result. Text blocks automatically
highlight valid JSON, newline-delimited JSON, supported language fences, and distinctive source
constructs for SQL, JavaScript, TypeScript, Python, Rust, Go, Java, C/C++, and CSS. Ambiguous text
and unsupported formats stay plain. Automatic detection skips blocks longer than 32,000 characters;
live console output stays plain until the command finishes.

File paths and web links remain clickable inside highlighted text. The copy action copies the full
original payload, including any text omitted from the bounded conversation preview.

### One verdict per tool

A run decides its roster once, in the tool ledger, and every consumer reads that answer: the model's
schemas, the system prompt, the Capabilities screen, and the error a withheld tool returns. Each
verdict is one of three states.

| State    | Meaning                                                                   | Boundary                                                              |
| -------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Live     | On the wire this turn.                                                    | `read`, `edit`, `write`, `apply_patch`, `search`, `bash`, `ask`, …    |
| Deferred | Dispatchable, but its schema is not sent until `activate_tools` names it. | Named only in the `activate_tools` catalog; activation is remembered. |
| Withheld | Not in this run at all, with the reason recorded.                         | A call to it returns the reason, not a bare "tool not found".         |

Every core tool is sent directly on supported interactive runs. Plugin and MCP call tools are
deferred by provenance because their combined catalog can grow without bound; `activate_tools` makes
those schemas available when the agent needs them. The prompt's `# Available tools` roster lists
what is on the wire — the activator included, deferred tools not — and `# Plugins` counts each
plugin's direct tools and the ones still to activate. The activation catalog excludes tools already
available in the run, including tools brought by an open plugin view. An unknown-name response lists
only tools that still need activation.

### Why a tool is withheld

Four layers decide, in this order, and a lower one can never return what an upper one took.

| Layer     | Question                                                 | Remediable                                                    |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| Shape     | May a chat / sub-agent / unattended run carry it at all? | No. The tool declares this itself, and the run is never told. |
| Authority | Does the host have the service or power it needs?        | No. Connect the workbench or service it needs.                |
| Policy    | Did you switch it off for this scope?                    | Yes — the agent may propose the switch back.                  |
| Economy   | Is it on the wire or behind `activate_tools`?            | Not a denial; the model activates it itself.                  |

Only a policy reason carries a remedy, and only those reach the agent: they are listed in its
`# Unavailable tools` section with the change that restores each one. See
[Propose configuration changes](configure.md).

### Where familiar operations went

| Former tool    | Now                                                                                       | Why                                                                               |
| -------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `monitor`      | `bash` with `until` (the same monitors engine polls and wakes)                            | One field instead of a second tool with its own schema.                           |
| `localix_ui`   | Write the exact `localix://` URI in the reply; the transcript renders it as a button.     | The catalogue search duplicated what a link already does.                         |
| `user_profile` | `memory` with `scope: "global"`; the profile itself is edited in Settings and onboarding. | The profile is context about the person and is injected regardless of the roster. |

### Measuring the floor

`context_budget` answers with the fixed per-request cost split into prompt and tool schemas and
names the heaviest schemas, so a session that feels expensive can be read rather than guessed at.
With `~/.localix/wire-dump.on` present, each run also writes `fixed.json` beside its request dumps:
the system prompt with per-section sizes and every tool's schema size.

### Schema budget

`tool-schema-budget.test.ts` renders the roster a fully composed chat host builds, from the real
tool factories (`vault`, `configure` and bash's terminal fields included), and fails when the sum
passes 7,000 tokens or one tool passes 800. A second case fails when the harness measures a stub or
misses a host-injected tool. `browser` advertises interactions once, as the step shape inside
`steps`, and `vault` is one flat object rather than a union per action. Every field name is
snake_case (`tool-schema-case.test.ts`). A flat `browser` interaction written the old way is refused
with the one-step batch that replaces it.

## Configuration

| Setting                         | Effect                                            | Boundary                                                     |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `disabledTools` (user, project) | Removes named tools from the next run.            | Protected tools are never suggested for removal by the GC.   |
| Role profile                    | Fixes the tool exposure of a sub-agent or worker. | A role never gains a tool its shape declares as unavailable. |

## Limits

- Deferral is a wire decision: a deferred tool stays dispatchable, and a model that never activates
  it still sees its name in the system prompt.
- The default roster figure is an estimate from the JSON Schema; providers tokenize schemas
  differently, and the measured fixed overhead of a request also includes the system prompt and the
  runtime context rows.
- `browser` drives a page only through an open, engaged Browser tab; without one it reports that it
  could not look.

## Related guides

- [Manage the tool budget](tool-budget.md)
- [Propose configuration changes](configure.md)
- [Wait for something to happen](monitors.md)
- [Capabilities](capabilities.md)

## Source of truth

- [Tool catalog and per-shape exposure](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-names.ts)
- [Tool ledger: one verdict per tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-ledger.ts)
- [Policy sets: GC-protected, deferred](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-policy-sets.ts)
- [Wire assembly and deferral](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/tool-assembly.ts)
- [Schema budget ratchet](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-schema-budget.test.ts)
- [`bash until` wait](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/bash/bash-until.ts)
