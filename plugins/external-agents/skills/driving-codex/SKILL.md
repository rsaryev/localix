---
name: driving-codex
description:
  Full reference for delegating work to the Codex CLI (`codex`) — driving it INTERACTIVELY in a
  terminal (open/screen/keys/type, handling approval prompts) and the headless `codex exec` mode,
  with all the flags, sandbox/approval modes, in-session slash commands, model selection, and
  gotchas. Use when delegating a task to Codex.
---

# Delegating to Codex (`codex`)

`codex` is the OpenAI Codex CLI — a coding agent. Delegate a self-contained task to it when you want
a second agent to do focused work. Two ways to run it: **interactive** (drive its TUI — you watch
and approve) or **headless** via the `codex exec` subcommand (one-shot, prints and exits). Prefer
interactive when you want to follow along or approve; headless when you just want the result.

First check it exists: `codex --version` (and `which codex`). If absent, tell the user.

## Launching it as a Localix delegation

Open the pane with a command in EXACTLY this shape:

```sh
LOCALIX_AGENT=codex LOCALIX_AGENT_CWD='/path/to/project' codex
```

The two leading assignments are **declarations, not noise**: `LOCALIX_AGENT` states which agent this
terminal runs, for the case where argv cannot say it (a wrapper, an alias, a sandbox runner), and
`LOCALIX_AGENT_CWD` is the constraint that keeps a second delegation of the same kind from being
correlated to this one's transcript. Stripping them, reordering them, or prefixing a `cd` costs you
the live state and the transcript correlation, silently. Append ` -m <name>` at the END to target a
model.

**Nothing is prepended to the task, and the delegate is not asked to report back.** Its state is
read by observation: the rendered screen classified against this plugin's detection manifest, and
codex's own JSONL transcript, whose last record says whether a turn is still running. Do not invent
a protocol, do not ask it to curl anything, and do not have it write a status file — none of that is
read. Send the refined task as ONE `type` call with `keys: ["Enter"]`.

## Interactive driving (preferred for delegation)

Drive the TUI with the **bash interactive actions** (`action: open` / `screen` / `keys` / `type`).
Always **read the screen** before acting.

1. **Open** in the project dir: bash `action: open`, `command: codex`. Append `-m <name>` only if a
   specific model is wanted (see _Models_ — don't assume names). It can take ~1s to render; the
   first `screen` may be blank — screen again.
2. **Wait** for the prompt: bash `action: screen`.
3. **Submit the task**: bash `action: type` with the full task text, then bash `action: keys`
   `keys: ["Enter"]`.
4. **Watch** it work: bash `action: screen` (it already waits for output to settle — read → act →
   read again, not a tight loop). For a long run, stop watching altogether and use _After you
   launch_ below; kill it (Ctrl+C / `action: close`) if it's stuck or stale.
5. **Approvals**: Codex asks before running shell commands / edits. Read the on-screen menu and
   approve — or pick an **always-allow / don't-ask-again** option if offered to let it proceed
   without re-asking. Always screen first to see the real options; never guess.
6. **Finish**: read the final result off the screen.
7. **Exit**: `keys: ["Ctrl+C"]` (the reliable exit; press twice if the first is a "press again to
   quit" prompt), or a quit slash-command if the screen shows one. Then bash `action: close`.

### In-session slash commands

These are TUI-internal (not in `--help`) and vary by version — type `/` and **read the screen**, or
run `/help` to see the actual list. Commonly available: `/model` (switch model), `/help`, and a
quit/new-conversation command. Don't assume exact names; the screen shows them.

## After you launch: roster, state, waiting

The delegation joins the **External Agents Workspace** roster the moment you `open` it, next to the
on-disk history of every other agent. Its live state (`working` / `blocked` / `idle` / `done` /
`unknown`) is classified from the screens you already read — a screen read is what updates it, so a
delegation nobody has looked at shows its last observed state.

- `external_agent_sessions { action: "roster" }` — where the keys come from. A live delegation is
  `codex:<id>`, or `codex:pending-terminal-<n>` until its transcript is correlated on disk; `wait`
  accepts either.
- `external_agent_sessions { action: "explain", key }` — why the state is what it is (authority,
  matched rule), when a state looks wrong.

**One delegation.** Nothing wakes this session on its own: no report arrives, because the delegate
is never asked to send one. Either `wait` on its key (bounded at 30 min, and a timeout is a normal
reported outcome), or end your turn and pick the work up next turn with `roster`. Do not poll the
screen in a loop, and do not use `bash action:"wait"` — that holds THIS turn open on a 120 s
ceiling.

**Several delegations at once: `wait` is what it exists for.** It asks the two orchestration
questions a per-delegation check cannot: "wake me when the FIRST needs a decision" and "wake me when
ALL have finished".

```
external_agent_sessions { action: "wait", keys: ["codex:<id>", "claude-code:<id>"],
                 mode: "all", until: ["done", "blocked"], timeoutMs: 1800000 }
```

- `mode: "all"` — return when every key has settled. `mode: "any"` — return on the FIRST, which is
  how you catch whichever agent needs an approval without polling the others.
- `until` defaults to `idle`/`done`/`blocked`, the settled states. `unknown` is never implied: it
  does not prove completion.
- A wait whose condition already holds returns immediately, and a key with no live delegation counts
  as settled and is reported `not-live` — so an `all` wait cannot hang on a key that will never
  move.
- A timeout is a normal, reported outcome rather than an error, and the result names the final state
  of every key. 30 minutes is the ceiling per call.

## Headless one-shot (`codex exec`)

`codex exec` runs non-interactively. Run it via bash (foreground, or `background:true` for long
tasks).

**Never interpolate the task into the shell command line.** A task containing quotes, backticks,
`$(…)`, or newlines breaks the command — or executes. `codex exec` reads the prompt from **stdin**
when the prompt argument is `-`, so feed the task via a quoted heredoc (the shell performs NO
expansion on the body):

```sh
codex exec --skip-git-repo-check - <<'LOCALIX_TASK'
<refined task — quotes, backticks, $( ), and newlines are all inert here>
LOCALIX_TASK
```

The only constraint is that no task line may be exactly `LOCALIX_TASK`. This is the ONLY approved
headless delivery; `codex exec -- "<task>"` with the task spliced into the string is forbidden.

Key flags (on `codex exec`):

- `-m, --model <name>` — model (see _Models_)
- `-C, --cd <dir>` — working root · `--add-dir <dir>` — extra writable dir
- `-s, --sandbox <mode>` — `read-only` (default-safe), `workspace-write` (let it edit the repo), or
  `danger-full-access`. Use `workspace-write` to let it make changes (`exec` runs non-interactively,
  so it auto-proceeds within the sandbox you grant — no on-screen approvals).
- `--dangerously-bypass-approvals-and-sandbox` — skip ALL approvals AND sandboxing (only in an
  externally-sandboxed env — risky). (Note: this codex version has no `--full-auto` flag; grant
  autonomy via `--sandbox` / this bypass. The interactive `codex` has
  `-a/--ask-for-approval <policy>`, but `codex exec` does not.)
- `--skip-git-repo-check` — allow running outside a git repo (needed in non-repo dirs)
- `-c key=value` — override any config (TOML dotted path), e.g. `-c model_reasoning_effort=high`,
  `-c model="o3"` · `--enable <feature>` / `--disable <feature>` — feature flags
- `--json` — emit events as JSONL · `-o, --output-last-message <file>` — write the final message to
  a file
- `--output-schema <file>` — constrain the final response to a JSON Schema · `-i, --image <file>` —
  attach image(s)
- `--ephemeral` — don't persist the session · `codex exec resume <id> [--last]` — resume a session

Other subcommands: `codex review` (non-interactive code review), `codex resume`/`fork` (sessions),
`codex login`/`logout`, `codex mcp` (MCP servers), `codex doctor` (diagnose install/auth).

Examples (task always on stdin via `-`, never in the command string):

- Autonomous edit: `codex exec --skip-git-repo-check --sandbox workspace-write - <<'LOCALIX_TASK'` …
  task … `LOCALIX_TASK`
- Read-only investigation: `codex exec --skip-git-repo-check - <<'LOCALIX_TASK'` … task …
  `LOCALIX_TASK`
- Machine-readable: add `--json` and/or `-o /tmp/result.txt`.

## Models

Don't hardcode model names — they change. Pass a model with `-m <name>` or `-c model="<name>"`. To
see options, run `/model` inside an interactive session or `codex --help` / `codex exec --help`.
Reasoning effort: `-c model_reasoning_effort=<minimal|low|medium|high|xhigh>`. Open-source/local
providers: `--oss` + `--local-provider <lmstudio|ollama>`.

## Gotchas

- Headless mode is the **`exec`** subcommand — plain `codex "<task>"` opens the interactive TUI.
- Outside a git repo, `codex exec` refuses unless you pass `--skip-git-repo-check`.
- Default sandbox is restrictive (`read-only`); to let it modify files pass
  `--sandbox workspace-write` (or `--dangerously-bypass-approvals-and-sandbox` for full access).
- Cold start ~1s; first `screen` may be blank — screen again.
- Auth: if it errors, the user must `codex login` once; report it, don't try to log in
  non-interactively.
- Run `codex --help` / `codex exec --help` for the full, version-current flag list if anything is
  stale.
