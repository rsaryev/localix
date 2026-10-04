---
name: driving-claude-code
description:
  Full reference for delegating work to the Claude Code CLI (`claude`) — driving it INTERACTIVELY in
  a terminal (open/screen/keys/type, handling approval menus) and the headless `-p` one-shot mode,
  with all the flags, in-session slash commands, model selection, and gotchas. Use when delegating a
  task to Claude Code.
---

# Delegating to Claude Code (`claude`)

`claude` is the Claude Code CLI — a capable coding agent. Delegate a self-contained task to it when
you want a second agent to do focused work (implement a module, refactor, write tests). Two ways to
run it: **interactive** (drive its TUI — you watch and answer prompts) or **headless** (`-p`,
one-shot, prints and exits). Prefer interactive when you want to follow along or handle approvals;
headless when you just want the result.

First check it exists: `claude --version` (and `which claude`). If absent, tell the user.

## Launching it as a Localix delegation

Open the pane with a command in EXACTLY this shape:

```sh
LOCALIX_AGENT=claude-code LOCALIX_AGENT_CWD='/path/to/project' claude --dangerously-skip-permissions
```

The two leading assignments are **declarations, not noise**: `LOCALIX_AGENT` states which agent this
terminal runs, for the case where argv cannot say it (a wrapper, an alias, a sandbox runner), and
`LOCALIX_AGENT_CWD` is the constraint that keeps a second delegation of the same kind from being
correlated to this one's transcript. Stripping them, reordering them, or prefixing a `cd` costs you
the live state and the transcript correlation, silently. Append flags at the END only
(` --model <alias>` if a specific tier is wanted).

**Nothing is injected into the delegated agent's prompt, and it is not asked to report back.** Its
state is read by observation: the rendered screen classified against this plugin's detection
manifest, and claude's own JSONL transcript, whose last record says whether a turn is still running.
Do not invent a protocol, do not ask it to curl anything, and do not have it write a status file —
none of that is read.

### System-prompt flags (`claude` v2.1+)

- `--system-prompt <text>` / `--system-prompt-file <path>` — **REPLACE** the default system prompt.
- `--append-system-prompt <text>` / `--append-system-prompt-file <path>` — **ADD** to it.
- `--exclude-dynamic-system-prompt-sections` — move per-machine sections (cwd/env/git) to the first
  user message; ignored when `--system-prompt` is used.

## Interactive driving (preferred for delegation)

Drive the TUI with the **bash interactive actions** (`action: open` / `screen` / `keys` / `type`).
Always **read the screen** before acting — never assume what's on it.

1. **Open** in the project dir: bash `action: open`, `command:` the pre-assembled launch line
   (`--print-claude-command` above) —
   `LOCALIX_AGENT=… LOCALIX_AGENT_CWD=… claude --dangerously-skip-permissions --append-system-prompt '<protocol>'`,
   assignments included. This skips ALL approval prompts so it runs autonomously end-to-end. Append
   `--model <name>` only if a specific model is wanted (see _Models_ below — don't assume names). It
   cold-starts (~1s), so the first `screen` may be blank; just screen again.
2. **Wait** for the input box: bash `action: screen` until you see the prompt. On first use it may
   show a one-time bypass-permissions warning — read the screen and confirm it before continuing.
3. **Submit the task**: bash `action: type` with the full task text, then bash `action: keys`
   `keys: ["Enter"]`. (Enter submits; for a literal newline inside the prompt use Shift+Enter.)
4. **Watch** it work: bash `action: screen`. The screen read already waits for output to settle, so
   read → act → read again — don't re-screen in a tight loop. For a long run, stop watching
   altogether and use _After you launch_ below; if it's stuck or no longer relevant, kill it (Ctrl+C
   twice / `action: close`) rather than waiting more.
5. **Approvals**: with `--dangerously-skip-permissions` Claude will NOT pause for edit/command
   approval — it just runs. If a menu still appears for any reason (e.g. a numbered
   `❯ 1. Yes   2. Yes, and don't ask again   3. No`), read it and respond with the matching number
   or arrow keys + Enter. The screen always shows the real choices; never guess.
6. **Finish**: when it returns to the input box or prints a summary, read the final result off the
   screen.
7. **Exit**: `keys: ["Ctrl+C","Ctrl+C"]` (the reliable exit — Ctrl+C twice), then bash
   `action: close`.

### In-session slash commands

These are TUI-internal (not in `--help`) and vary by version — type `/` and **read the screen**, or
run `/help` for the actual list. Commonly available: `/model` (switch model — also shows what's
available, so use it instead of guessing names), `/help`, `/clear`, `/compact`, `/status`. Don't
assume exact names beyond what the screen shows.

## After you launch: roster, state, waiting

The delegation joins the **External Agents Workspace** roster the moment you `open` it, next to the
on-disk history of every other agent. Its live state (`working` / `blocked` / `idle` / `done` /
`unknown`) is classified from the screens you already read — a screen read is what updates it, so a
delegation nobody has looked at shows its last observed state.

- `external_agent_sessions { action: "roster" }` — where the keys come from. A live delegation is
  `claude-code:<id>`, or `claude-code:pending-terminal-<n>` until its transcript is correlated on
  disk; `wait` accepts either.
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
external_agent_sessions { action: "wait", keys: ["claude-code:<id>", "codex:<id>"],
                 mode: "all", until: ["done", "blocked"], timeoutMs: 1800000 }
```

- `mode: "all"` — return when every key has settled. `mode: "any"` — return on the FIRST, which is
  how you catch whichever agent needs a decision without polling the others.
- `until` defaults to `idle`/`done`/`blocked`, the settled states. `unknown` is never implied: it
  does not prove completion.
- A wait whose condition already holds returns immediately, and a key with no live delegation counts
  as settled and is reported `not-live` — so an `all` wait cannot hang on a key that will never
  move.
- A timeout is a normal, reported outcome rather than an error, and the result names the final state
  of every key. 30 minutes is the ceiling per call.

## Headless one-shot (`-p`)

`claude -p` runs non-interactively, prints the response, and exits — good when you don't need to
watch or approve. Run it via bash (foreground, or `background:true` for long tasks).

**Never interpolate the task into the shell command line.** A task containing quotes, backticks,
`$(…)`, or newlines breaks the command — or executes. `-p` reads the prompt from **stdin** when it
is piped, so feed the task via a quoted heredoc (the shell performs NO expansion on the body):

```sh
claude -p --output-format text --dangerously-skip-permissions <<'LOCALIX_TASK'
<refined task — quotes, backticks, $( ), and newlines are all inert here>
LOCALIX_TASK
```

The only constraint is that no task line may be exactly `LOCALIX_TASK`. This is the ONLY approved
headless delivery; `claude -p "<task>"` with the task spliced into the string is forbidden.

Key flags:

- `-p, --print` — non-interactive print mode
- `--model <name>` — model (alias or full id; see _Models_)
- `--permission-mode <mode>` — one of `default`, `acceptEdits`, `plan`, `bypassPermissions`,
  `dontAsk`, `auto`. For autonomous edits use `acceptEdits`; for read-only investigation use `plan`.
- `--output-format <fmt>` — `text` (default), `json` (single result), `stream-json` (NDJSON stream)
- `--add-dir <dirs...>` — extra writable dirs · `--max-turns <n>` — cap agent turns
- `--continue` / `--resume [id]` — continue the most recent / a specific session
- `--allowedTools` / `--disallowedTools` — tool allow/deny lists (e.g. `"Bash(git *)" Edit`)
- `--append-system-prompt <text>` — add to the system prompt
- `--dangerously-skip-permissions` — bypass ALL permission checks (sandboxes only — risky)
- `--fallback-model <m,...>` — auto-fallback when the primary is overloaded (with `--print`)

Examples (task always on stdin, never in the command string):

- Autonomous one-shot:
  `claude -p --dangerously-skip-permissions --output-format text <<'LOCALIX_TASK'` … task …
  `LOCALIX_TASK`
- Plan only (no edits): `claude -p --permission-mode plan <<'LOCALIX_TASK'` … task … `LOCALIX_TASK`

## Models

Don't hardcode model names — they change. Claude accepts a short **alias** for the latest model
(e.g. opus / sonnet / haiku / fable) or a full model id. To see the current options, run `/model`
inside an interactive session, or `claude --help` (the `--model` entry lists aliases). Pass the
choice via `--model <name>` (works in both interactive and `-p`). Reasoning effort:
`--effort <low|medium|high|xhigh|max>`.

## Gotchas

- It starts an **interactive** session by default — you MUST use `-p` for a headless one-shot.
- Cold start takes ~1s; the first `screen` is often blank — screen again rather than retyping.
- Permission prompts block until answered — in interactive mode you must respond; in headless, set
  an appropriate `--permission-mode` up front (it won't pause for input).
- Auth: if it errors on auth, the user must `claude` (login) once interactively, or set
  `ANTHROPIC_API_KEY`. Report it; don't try to log in non-interactively.
- Run `claude --help` for the full, version-current flag list if anything here is stale.
