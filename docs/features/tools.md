# Know the tool roster

The tool roster is the set of model-facing tools available to a run. Core tools are sent directly,
except `Configure`, `Vault` and `ExternalAgentSessions`, which wait in `ToolSearch`'s catalog; mini
app and MCP tool schemas are deferred until activated, unless the turn's linked workbench brings
them onto the request.

The schema-budget test caps the fully composed core chat registry at an estimated 7,750 tokens, with
an 800-token ceiling per tool. This is a test ceiling, not a measurement of every request: agent
rules, host services, model compatibility, and activated extensions change the actual roster.

## Tool names

Every core tool has one name, spelled as Claude Code spells its own: `Read`, `Bash`, `Edit`. The
model calls it by that name, a hook or a mod sees it, a permission rule names it (`tool:Bash`),
Settings lists it and the conversation shows it, so a roster never mixes two styles. A prompt, skill
or agent file written for Claude Code names the tools it expects, and a model trained on Claude Code
calls them without a lookup.

| Core tools                                                                    |
| ----------------------------------------------------------------------------- |
| `Read`, `Write`, `Edit`, `Search`, `Bash`, `Jobs`, `Research`, `Browser`      |
| `AskUserQuestion`, `Skill`, `Plan`, `Loops`, `Workflow`, `Store`, `Configure` |
| `Agent`, `SendMessage`, `TaskStop`, `ToolSearch`, `Vault`                     |
| `GlobalSearch`, `ToolOutput`, `ContextBudget`, `McpResources`, `MiniAppGuide` |
| `ExternalAgentSessions`                                                       |

Rules, usage counts and saved conversations that were written before the tools took one name each
were rewritten to these names once, when Localix updated its database. Localix reads only these
names: an agent file's `tools` list, a skill's `allowed-tools` or a hook matcher has to use them.

The tools whose name is Claude Code's take its arguments too: `AskUserQuestion` reads `header` and
`multiSelect`, `Skill` reads `{ skill, args }`, and `ToolSearch` takes `query` as `select:A,B` for
exact names or as keywords that load the best matches (`max_results`, five by default). A Claude
Code hook or a mod sees the same name the model called. Mini app, plugin and MCP tools keep the
names they were given, and none of them can take a core tool's name.

## What you can do

| Action                            | Mechanism                                                                                                                                          | Availability and boundary                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read any file                     | `Read` returns text, an image as a picture, PDF/office text (`pages`, `sheet`), notebook cells or a directory listing.                             | Images over 10 MB are refused; a text-only model gets an image's size as text. Documents need the Documents mini app.                                           |
| Read several files at once        | `Read` with `reads: [{ path, start_line?, end_line? }]`; `Search` with `queries: [...]` for several patterns.                                      | One call, answered per file or per query; see [Batch reads and searches](#batch-reads-and-searches).                                                            |
| Change several files at once      | One `Edit` call carries `edits: [{ path, old_string, new_string }]`; one `Write` call carries `files: [{ path, content }]`.                        | Each file applies or fails on its own; see [Change files in one call](#change-files-in-one-call).                                                               |
| See the roster of a session       | Inspect the agent's tools in **Settings → Permissions**, or ask for `ContextBudget`.                                                               | Settings shows configured access; `ContextBudget` estimates the current run's schemas.                                                                          |
| Remove a tool from later runs     | Add a `tool:<name>` rule with effect `deny` for the agent in Settings → Permissions.                                                               | Applies to the next run; see [Manage the tool budget](tool-budget.md).                                                                                          |
| Reach a deferred tool             | The model calls `ToolSearch` with `select:<name>` or with keywords.                                                                                | The activation is remembered on the session and survives a context checkpoint.                                                                                  |
| Use an open mini app's tools      | Link the mini app's tab to the message (open tabs link by default), or let it wake the chat.                                                       | Uses the message's linked context; tab/chip changes take effect when you send.                                                                                  |
| Learn why a tool is missing       | Ask the agent; it reads the run's ledger through `Configure` with `action: "inspect"`.                                                             | Read-only; requires `Configure` in the run. Known withheld tools report their reasons.                                                                          |
| Wait for something external       | `Bash` with `until: <seconds>` polls the command and wakes the session when it exits 0.                                                            | Needs a manageable job (`Jobs` present); see [Wait for something](monitors.md).                                                                                 |
| Plan before building              | The Kanban mini app's `kanban` tool: put the work on the chat's board before starting.                                                             | A deferred mini app tool on a passive board; see the [Kanban guide](task-board.md).                                                                             |
| Show you something                | The agent links it in its reply: a file as `localix://ui/work-item/file?path=…&line=…`, a mini app view by the `App view:` link its tool returned. | Nothing opens on its own; you open a link when you choose.                                                                                                      |
| Find, install or create a package | `Store` searches the sources you added, shows a package's plan, and installs, updates, removes, enables, disables, or creates an agent or skill.   | Root chats only; each change waits for your approval and a run nobody can answer refuses it. See [Store](store.md) and [Agent management](agent-management.md). |

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

### Change files in one call

`Edit` and `Write` batch, so a change across several files is one model round-trip, one approval
card listing every path, and one result.

| Rule                  | `Edit`                                                                                  | `Write`                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Within one file       | Edits apply in order; each matches the text the previous edit left.                     | One entry per file; the same file twice in a call is refused before anything is written.  |
| A failure             | A missing or ambiguous `old_string` fails the whole file, naming `edits[i]`.            | A stale file, a missing parent with `create_directories: false`, or an I/O error.         |
| Other files           | Still applied; the result names each failed file and why, and nothing is written to it. | Same. An unread existing file refuses the whole call first and shows its current content. |
| Call status           | An error only when no file was applied.                                                 | Same.                                                                                     |
| Locks and diagnostics | Every path is locked together; language-server diagnostics cover the changed files.     | Same.                                                                                     |

The single-file shapes still work: a top-level `path` with `old_string`/`new_string` or `content`,
and Claude Code's `Edit`, `Write` and `MultiEdit` inputs, are lifted into the batch before
validation, so a PreToolUse hook's `updatedInput` in those shapes is accepted. A hook's
`Edit(<glob>)` guard matches a batch when any of its paths matches.

An edit whose `new_string` equals its `old_string` changes nothing. In a batch, the tool skips that
edit, names it in the result and applies the other edits. A file whose every edit is a no-op still
fails. An entry key with a stray character at either end, such as `.new_string`, is renamed to the
key it names when that key is missing.

### Batch reads and searches

One `Read` call can open several files. `path` keeps every single-file option (`byte_offset`,
`limit`, `pages`, `sheet`, `mode`); each `reads` entry adds a file with its own optional line range
and inherits `cwd`, `mode`, `pages` and `sheet`. A bare string entry is read as `{ path }`, and an
entry repeated in one call is read once.

```json
{ "reads": [{ "path": "src/a.ts" }, { "path": "src/b.ts", "start_line": 40, "end_line": 90 }] }
```

The items run concurrently, four at a time. The answer has one `### <path>` section per file in the
order asked. A missing or unreadable file is reported in its own section; the call fails only when
every file failed. Each file keeps its single-read caps, and the call has a budget of its own: 12
files, about 160 KB of text and six images (10 MB). Files past the budget are not delivered, and the
answer names them to read separately. Images come back as separate image parts, numbered in the
text.

Every file is handled as if read alone: the permission gate checks each path for workspace
containment, secrets and path rules, and the stale-file guard records each file's modification time.
A file the call left out records nothing. A repeat read always returns the file's current content,
never a pointer at an earlier read.

`Search` accepts `queries` beside `query`. Each pattern runs the full single-search pipeline,
including its retries, and the results are grouped under a `### "<pattern>"` header. One call runs
up to eight patterns and returns up to 64 KB of results; the rest are named back to run separately.
A repeated search returns its full results again. The tool card shows a row per file or per pattern.

### Claude Code arguments

A prompt, skill or agent written for Claude Code calls `Read`, `Grep`, `Glob`, `Bash`, `WebFetch`
and `WebSearch` with their own arguments. The tools take them as written, and refuse a call whose
two spellings of one thing disagree, or that asks for what the tool cannot do, instead of running
something else.

| Tool       | Claude Code argument                                | Meaning here                                                                                      |
| ---------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Read`     | `file_path`                                         | `path`                                                                                            |
| `Read`     | `offset`, `limit`                                   | The first line and the number of lines. A byte position is `byte_offset`, as a cut-off read says  |
| `Search`   | `pattern`, `path`                                   | The regex, or a file pattern for a listing when it is a bare glob such as `src/**/*.ts`           |
| `Search`   | `output_mode`, `head_limit`, `type`, `multiline`    | Kept. A call with `pattern` and no mode lists the matching files, as `Grep` does                  |
| `Search`   | `-i`, `-A`, `-B`, `-C`, `context`                   | `ignore_case`, and one `context` as wide as the widest. `-n` changes nothing; `offset` is refused |
| `Bash`     | `run_in_background`, `description`, `timeout` in ms | `background`; the label is dropped; a timeout above 600 is milliseconds, rounded up to seconds    |
| `Research` | `url`, `prompt`, `query`                            | A page to read for that question, or the question to search for                                   |
| `Research` | `allowed_domains`, `blocked_domains`                | `include_domains`, `exclude_domains`                                                              |

### One verdict per tool

Run assembly records a verdict for each known tool in the tool ledger. The initial schemas and
prompt roster follow that assembly; `Configure inspect` reads its reasons. Settings builds a
capability snapshot for the selected scope, rather than reading a running session's ledger. Host
services and model compatibility can therefore make an allowed Settings tool unavailable to this
run. Later activation reveals additional schemas through the adapter. Each assembly verdict is one
of three states.

| State    | Meaning                                                               | Boundary                                                                    |
| -------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Live     | On the wire this turn.                                                | `Read`, `Edit`, `Write`, `Search`, `Bash`, `AskUserQuestion`, …             |
| Deferred | Dispatchable, but its schema is not sent until `ToolSearch` names it. | Named only in the `ToolSearch` catalog; activation is remembered.           |
| Withheld | Not available for execution, with the reason recorded.                | Known withheld names have dispatch-only error stubs; unknown names may not. |

Core tools that survive run-shape, host, model, and policy gates are sent directly, except three a
run seldom calls: `Configure`, `Vault` and `ExternalAgentSessions` are listed in the catalog under
`[Localix]`, as Claude Code defers the tools it seldom needs. Their schemas reach the request the
turn the agent loads one, and a call by name reaches the tool without loading it. An agent whose
`tools` list names one keeps it on the wire.

Mini app and MCP call tools are deferred by provenance because their combined catalog can grow
without bound; `ToolSearch` makes those schemas available when the agent needs them. The prompt's
`# Available tools` roster lists what is on the wire — the activator included, deferred tools not —
and `# Mini apps` lists each enabled mini app and says which of its tools wait behind `ToolSearch`.
The activation catalog excludes tools already available in the run, including tools brought by an
open mini app view. An unknown-name response lists only tools that still need activation.

### Why a tool is withheld

The ledger checks shape, host authority, model compatibility, and policy in that order. Deferral
then changes which allowed schemas are sent; it does not grant access.

| Layer     | Question                                                   | Remediable                                                      |
| --------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| Shape     | May a chat / sub-agent / unattended run carry it at all?   | No. The tool declares this itself, and the run is never told.   |
| Authority | Does the host have the service or power it needs?          | No. Connect the workbench or service it needs.                  |
| Model     | Can the selected model read the output this tool requires? | No. Choose a compatible model, such as one that accepts images. |
| Policy    | Did you switch it off for this agent?                      | Yes — the agent may propose the switch back.                    |
| Economy   | Is it on the wire or behind `ToolSearch`?                  | Not a denial; the model activates it itself.                    |

Only policy reasons carry a configuration remedy. The `# Unavailable tools` section lists those
remediable denials and the change that restores each tool. See
[Propose configuration changes](configure.md).

### Where familiar operations went

| Former tool   | Now                                                                                   | Why                                                                   |
| ------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `monitor`     | `Bash` with `until` (the same monitors engine polls and wakes)                        | One field instead of a second tool with its own schema.               |
| `view_image`  | `Read` on the image file                                                              | One reading entry point; a misnamed image is recognised by its bytes. |
| `apply_patch` | `Edit` for a change to an existing file, `Write` for a whole file                     | An exact `old_string` has no context lines to drift.                  |
| `localix_ui`  | Write the exact `localix://` URI in the reply; the transcript renders it as a button. | The catalogue search duplicated what a link already does.             |

### Measuring the floor

`ContextBudget` answers with the fixed per-request cost split into prompt and tool schemas and names
the heaviest schemas, so a session that feels expensive can be read rather than guessed at. With
`~/.localix/wire-dump.on` present, each run also writes `fixed.json` beside its request dumps: the
system prompt with per-section sizes and every tool's schema size.

### Schema budget

`tool-schema-budget.test.ts` builds the core chat registry from real factories, including `Vault`,
`Configure`, and Bash terminal fields. It rejects a total above 7,750 estimated tokens, any tool
above 800, missing host-injected tools, and name-only stubs. The separate `tool-schema-case.test.ts`
checks snake_case field names. Mini app and MCP schemas added during a run are outside this
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
  permissions or mini app availability can remove a remembered tool. A context checkpoint does not
  itself remove the remembered names.
- The default roster figure is an estimate from the JSON Schema; providers tokenize schemas
  differently, and the measured fixed overhead of a request also includes the system prompt and the
  runtime context rows.
- `Browser open` can create a Preview, but control requires a connected Localix application and a
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
- [`Bash until` wait](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/bash/bash-until.ts)
