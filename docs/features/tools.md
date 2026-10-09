# Know the tool roster

The tool roster is the set of model-facing tools available to a run. Core tools are sent directly;
plugin and MCP tool schemas are deferred until activated, unless the turn's linked workbench brings
them onto the request.

The schema-budget test caps the fully composed core chat registry at an estimated 7,500 tokens, with
an 800-token ceiling per tool. This is a test ceiling, not a measurement of every request: agent
rules, host services, model compatibility, and activated extensions change the actual roster.

## What you can do

| Action                        | Mechanism                                                                                      | Availability and boundary                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| See the roster of a session   | Inspect the agent's tools in **Settings → Capabilities → Tools**, or ask for `context_budget`. | Settings shows configured access; `context_budget` estimates the current run's schemas. |
| Remove a tool from later runs | Add a `tool:<name>` rule with effect `deny` for the agent in Settings → Capabilities.          | Applies to the next run; see [Manage the tool budget](tool-budget.md).                  |
| Reach a deferred tool         | The model calls `activate_tools` with the exact name.                                          | The activation is remembered on the session and survives a context checkpoint.          |
| Use an open plugin's tools    | Link the plugin's tab to the message (open tabs link by default), or let it wake the chat.     | Uses the message's linked context; tab/chip changes take effect when you send.          |
| Learn why a tool is missing   | Ask the agent; it reads the run's ledger through `configure` with `action: "inspect"`.         | Read-only; requires `configure` in the run. Known withheld tools report their reasons.  |
| Wait for something external   | `bash` with `until: <seconds>` polls the command and wakes the session when it exits 0.        | Needs a manageable job (`jobs` present); see [Wait for something](monitors.md).         |
| Plan before building          | The Kanban plugin's `kanban` tool: put the work on the chat's board before starting.           | A deferred plugin tool on a passive board; see the [Kanban guide](task-board.md).       |

For live PTY input and rendered-screen waits, see
[Interact with a terminal](interactive-terminals.md).

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

Run assembly records a verdict for each known tool in the tool ledger. The initial schemas and
prompt roster follow that assembly; `configure inspect` reads its reasons. Settings builds a
capability snapshot for the selected scope, rather than reading a running session's ledger. Host
services and model compatibility can therefore make an allowed Settings tool unavailable to this
run. Later activation reveals additional schemas through the adapter. Each assembly verdict is one
of three states.

| State    | Meaning                                                                   | Boundary                                                                    |
| -------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Live     | On the wire this turn.                                                    | `read`, `edit`, `write`, `apply_patch`, `search`, `bash`, `ask`, …          |
| Deferred | Dispatchable, but its schema is not sent until `activate_tools` names it. | Named only in the `activate_tools` catalog; activation is remembered.       |
| Withheld | Not available for execution, with the reason recorded.                    | Known withheld names have dispatch-only error stubs; unknown names may not. |

Core tools that survive run-shape, host, model, and policy gates are sent directly. Plugin and MCP
call tools are deferred by provenance because their combined catalog can grow without bound;
`activate_tools` makes those schemas available when the agent needs them. The prompt's
`# Available tools` roster lists what is on the wire — the activator included, deferred tools not —
and `# Plugins` counts each plugin's direct tools and the ones still to activate. The activation
catalog excludes tools already available in the run, including tools brought by an open plugin view.
An unknown-name response lists only tools that still need activation.

### Why a tool is withheld

The ledger checks shape, host authority, model compatibility, and policy in that order. Deferral
then changes which allowed schemas are sent; it does not grant access.

| Layer     | Question                                                   | Remediable                                                      |
| --------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| Shape     | May a chat / sub-agent / unattended run carry it at all?   | No. The tool declares this itself, and the run is never told.   |
| Authority | Does the host have the service or power it needs?          | No. Connect the workbench or service it needs.                  |
| Model     | Can the selected model read the output this tool requires? | No. Choose a compatible model, such as one that accepts images. |
| Policy    | Did you switch it off for this agent?                      | Yes — the agent may propose the switch back.                    |
| Economy   | Is it on the wire or behind `activate_tools`?              | Not a denial; the model activates it itself.                    |

Only policy reasons carry a configuration remedy. The `# Unavailable tools` section lists those
remediable denials and the change that restores each tool. See
[Propose configuration changes](configure.md).

### Where familiar operations went

| Former tool  | Now                                                                                   | Why                                                       |
| ------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `monitor`    | `bash` with `until` (the same monitors engine polls and wakes)                        | One field instead of a second tool with its own schema.   |
| `localix_ui` | Write the exact `localix://` URI in the reply; the transcript renders it as a button. | The catalogue search duplicated what a link already does. |

### Measuring the floor

`context_budget` answers with the fixed per-request cost split into prompt and tool schemas and
names the heaviest schemas, so a session that feels expensive can be read rather than guessed at.
With `~/.localix/wire-dump.on` present, each run also writes `fixed.json` beside its request dumps:
the system prompt with per-section sizes and every tool's schema size.

### Schema budget

`tool-schema-budget.test.ts` builds the core chat registry from real factories, including `vault`,
`configure`, and Bash terminal fields. It rejects a total above 7,500 estimated tokens, any tool
above 800, missing host-injected tools, and name-only stubs. The separate `tool-schema-case.test.ts`
checks snake_case field names. Plugin and MCP schemas added during a run are outside this
core-registry ceiling.

## Configuration

| Setting                | Effect                                                         | Boundary                                                          |
| ---------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Agent permission rules | A `tool:<name>` denial removes that candidate from later runs. | The rule belongs to the agent; see [Permissions](permissions.md). |
| Role profile           | Fixes the tool exposure of a sub-agent or worker.              | A role never gains a tool its shape declares as unavailable.      |

## Limits

- Deferral is a wire decision: a deferred implementation stays dispatchable, but its schema is not
  on the initial request. Its name appears in the activation catalog; the initial **Available
  tools** prompt roster lists only tools already on the wire.
- Activation storage is best-effort and only preserves names available to later runs. Changes to
  permissions or plugin availability can remove a remembered tool. A context checkpoint does not
  itself remove the remembered names.
- The default roster figure is an estimate from the JSON Schema; providers tokenize schemas
  differently, and the measured fixed overhead of a request also includes the system prompt and the
  runtime context rows.
- `browser open` can create a Preview, but control requires a connected Localix application and a
  ready page bridge. Opening a URL and observing the page are separate outcomes: check the opening
  result's readiness before claiming a visual check. See [Visual Feedback](visual-feedback.md).

## Related guides

- [Manage the tool budget](tool-budget.md)
- [Propose configuration changes](configure.md)
- [Wait for something to happen](monitors.md)
- [Capabilities](capabilities.md)

## Source of truth

- [Tool catalog and per-shape exposure](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-names.ts)
- [Tool ledger: one verdict per tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-ledger.ts)
- [Protected names for usage suggestions](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-policy-sets.ts)
- [Wire assembly and deferral](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/tool-assembly.ts)
- [Scoped Settings projection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/capabilities/snapshot.ts)
- [Known withheld-name errors](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/withheld-stub.ts)
- [Browser opening and readiness](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/browser/browser-open.ts)
- [Schema budget ratchet](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tool-schema-budget.test.ts)
- [`bash until` wait](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/bash/bash-until.ts)
