# Know the tool roster

The tool roster is the set of model-facing tools available to a run. Core tools are sent directly;
mini app and MCP tool schemas are deferred until activated, unless the turn's linked workbench
brings them onto the request.

The schema-budget test caps the fully composed core chat registry at an estimated 9,400 tokens, with
an 800-token ceiling per tool; `codemode` is exempt from the per-tool ceiling because it restates
the schemas of the tools its scripts call. This is a test ceiling, not a measurement of every
request: agent rules, host services, model compatibility, and activated extensions change the actual
roster.

## What you can do

| Action                        | Mechanism                                                                                                                                          | Availability and boundary                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Read any file                 | `read` returns text, an image as a picture, PDF/office text (`pages`, `sheet`), notebook cells or a directory listing.                             | Images over 10 MB are refused; a text-only model gets an image's size as text. Documents need the Documents mini app.  |
| Read several files at once    | `read` with `reads: [{ path, start_line?, end_line? }]`; `search` with `queries: [...]` for several patterns.                                      | One call, answered per file or per query; see [Batch reads and searches](#batch-reads-and-searches).                   |
| Change several files at once  | One `edit` call carries `edits: [{ path, old_string, new_string }]`; one `write` call carries `files: [{ path, content }]`.                        | Each file applies or fails on its own; see [Change files in one call](#change-files-in-one-call).                      |
| See the roster of a session   | Inspect the agent's tools in **Settings → Permissions**, or ask for `context_budget`.                                                              | Settings shows configured access; `context_budget` estimates the current run's schemas.                                |
| Remove a tool from later runs | Add a `tool:<name>` rule with effect `deny` for the agent in Settings → Permissions.                                                               | Applies to the next run; see [Manage the tool budget](tool-budget.md).                                                 |
| Reach a deferred tool         | The model calls `activate_tools` with the exact name.                                                                                              | The activation is remembered on the session and survives a context checkpoint.                                         |
| Use an open mini app's tools  | Link the mini app's tab to the message (open tabs link by default), or let it wake the chat.                                                       | Uses the message's linked context; tab/chip changes take effect when you send.                                         |
| Run a script over tools       | `codemode` runs JavaScript that calls `read`, `bash`, `edit` and `write` as `await tools.<name>(args)`.                                            | Only the script's output and return value reach the model; see [Run a script over tools](#run-a-script-over-tools).    |
| Learn why a tool is missing   | Ask the agent; it reads the run's ledger through `configure` with `action: "inspect"`.                                                             | Read-only; requires `configure` in the run. Known withheld tools report their reasons.                                 |
| Wait for something external   | `bash` with `until: <seconds>` polls the command and wakes the session when it exits 0.                                                            | Needs a manageable job (`jobs` present); see [Wait for something](monitors.md).                                        |
| Plan before building          | The Kanban mini app's `kanban` tool: put the work on the chat's board before starting.                                                             | A deferred mini app tool on a passive board; see the [Kanban guide](task-board.md).                                    |
| Show you something            | The agent links it in its reply: a file as `localix://ui/work-item/file?path=…&line=…`, a mini app view by the `App view:` link its tool returned. | Nothing opens on its own; you open a link when you choose.                                                             |
| Create a specialist           | `agents` lists the current registry or creates 1–8 reusable definitions with explicit priorities and inherited saved permissions.                  | Root chats only; tag a created handle to invite it and give it the floor. See [Agent management](agent-management.md). |

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

`edit` and `write` batch, so a change across several files is one model round-trip, one approval
card listing every path, and one result.

| Rule                  | `edit`                                                                                  | `write`                                                                                   |
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

One `read` call can open several files. `path` keeps every single-file option (`offset`, `limit`,
`pages`, `sheet`, `mode`); each `reads` entry adds a file with its own optional line range and
inherits `cwd`, `mode`, `pages` and `sheet`. A bare string entry is read as `{ path }`, and an entry
repeated in one call is read once.

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

`search` accepts `queries` beside `query`. Each pattern runs the full single-search pipeline,
including its retries, and the results are grouped under a `### "<pattern>"` header. One call runs
up to eight patterns and returns up to 64 KB of results; the rest are named back to run separately.
A repeated search returns its full results again. The tool card shows a row per file or per pattern.

### Run a script over tools

`codemode` lets the model write one script that chains calls, runs them in parallel, or filters a
large result down to what it needs, instead of spending a model round trip on each call. The script
is the body of an async function in a QuickJS sandbox with no Node, file system, network or timers.
It calls `read`, `bash`, `edit` and `write` (those the run has) as `await tools.<name>(args)`; a
call resolves to the tool's text result and rejects with its error.

`text(value)`, `console.log()` and the returned value are what the model reads; the results of the
calls stay in the script. The tool's description asks for a concise answer and for
`Promise.allSettled` or `try/catch`, so a whole file or listing never reaches the context when a
count or a few lines would do, and one failed call does not lose the others.

The agent is told to prefer a script when each call needs the previous result or a result is much
larger than the answer: grep, read the hits and keep what matters; run several checks and report
only the failures. Independent calls are still batched in one turn, and a single call or a file's
new content goes to the tool directly rather than through a script.

```js
const [readme, status] = await Promise.allSettled([
  tools.read({ path: 'README.md' }),
  tools.bash({ command: 'git status --short' }),
])
const changed = status.status === 'fulfilled' ? status.value.split('\n').filter(Boolean) : []
return {
  title: readme.status === 'fulfilled' ? readme.value.split('\n')[0] : readme.reason.message,
  changed: changed.length,
  modified: changed.filter((line) => line.startsWith(' M')).map((line) => line.slice(3)),
}
```

Each call a script makes goes through the same validation, permission rules, approvals and hooks as
a call the model makes directly, so a script reaches exactly what the run allows. An approval the
script was waiting on is withdrawn when the script stops. The script stops after 120 seconds. The
tool card shows the script, then one row per call with its files or command, outcome and time, then
the script's report.

### One verdict per tool

Run assembly records a verdict for each known tool in the tool ledger. The initial schemas and
prompt roster follow that assembly; `configure inspect` reads its reasons. Settings builds a
capability snapshot for the selected scope, rather than reading a running session's ledger. Host
services and model compatibility can therefore make an allowed Settings tool unavailable to this
run. Later activation reveals additional schemas through the adapter. Each assembly verdict is one
of three states.

| State    | Meaning                                                                   | Boundary                                                                    |
| -------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Live     | On the wire this turn.                                                    | `read`, `edit`, `write`, `search`, `bash`, `ask`, …                         |
| Deferred | Dispatchable, but its schema is not sent until `activate_tools` names it. | Named only in the `activate_tools` catalog; activation is remembered.       |
| Withheld | Not available for execution, with the reason recorded.                    | Known withheld names have dispatch-only error stubs; unknown names may not. |

Core tools that survive run-shape, host, model, and policy gates are sent directly. Mini app and MCP
call tools are deferred by provenance because their combined catalog can grow without bound;
`activate_tools` makes those schemas available when the agent needs them. The prompt's
`# Available tools` roster lists what is on the wire — the activator included, deferred tools not —
and `# Mini apps` lists each enabled mini app and says which of its tools wait behind
`activate_tools`. The activation catalog excludes tools already available in the run, including
tools brought by an open mini app view. An unknown-name response lists only tools that still need
activation.

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

| Former tool   | Now                                                                                   | Why                                                                   |
| ------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `monitor`     | `bash` with `until` (the same monitors engine polls and wakes)                        | One field instead of a second tool with its own schema.               |
| `view_image`  | `read` on the image file                                                              | One reading entry point; a misnamed image is recognised by its bytes. |
| `apply_patch` | `edit` for a change to an existing file, `write` for a whole file                     | An exact `old_string` has no context lines to drift.                  |
| `localix_ui`  | Write the exact `localix://` URI in the reply; the transcript renders it as a button. | The catalogue search duplicated what a link already does.             |

### Measuring the floor

`context_budget` answers with the fixed per-request cost split into prompt and tool schemas and
names the heaviest schemas, so a session that feels expensive can be read rather than guessed at.
With `~/.localix/wire-dump.on` present, each run also writes `fixed.json` beside its request dumps:
the system prompt with per-section sizes and every tool's schema size.

### Schema budget

`tool-schema-budget.test.ts` builds the core chat registry from real factories, including `vault`,
`configure`, `codemode`, and Bash terminal fields. It rejects a total above 9,400 estimated tokens,
any tool above 800 except `codemode`, missing host-injected tools, and name-only stubs. The separate
`tool-schema-case.test.ts` checks snake_case field names. Mini app and MCP schemas added during a
run are outside this core-registry ceiling.

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
