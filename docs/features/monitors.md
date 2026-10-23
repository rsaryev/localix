# Wait for something to happen

A wait is a background watch the agent starts and the session is woken by. Use it when work cannot
continue until something outside the session happens: a pipeline finishes, a deploy settles, a
service starts answering. The agent starts one with the `bash` tool — the check as `command`, plus
`until: <seconds>` — and ends its turn; the engine behind it (`features/monitors`) polls the command
on that interval and wakes the session when it exits 0.

Use a wait when a condition should resume the conversation. Localix runs the checks outside the
agent turn and delivers the matching output or ending reason to the owning participant.

## Terminology

| Term       | Meaning                                                                        | Boundary                                                                                   |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Monitor    | One background watch owned by one session, addressed as `mon-1`, `mon-2`.      | A trigger plus a work record, both durable; a polled wait survives an API restart.         |
| Wait       | The agent-facing shape: `bash` with `until`, polled until the command exits 0. | One predicate on purpose; richer logic (grep, jq, `--exit-status`) belongs in the command. |
| Watch mode | A long-running command whose output lines become events.                       | Engine capability; not exposed as a tool field. Its process ends with the server.          |
| Event      | One thing worth a turn: lines within 200 ms arrive as a single wake.           | Several events can share one turn through batching and wake-queue coalescing.              |
| Ending     | Condition met, command exited, timeout, stopped, rate-limited, or error.       | A monitor ends exactly once, and the reason travels with the last events.                  |

## What you can do

| Need                            | Mechanism                                                                           | Boundary                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Wait for a condition            | `bash` with `command` and `until: <seconds>`; the agent ends its turn.              | The interval floor is 5 s; 30 s or more is appropriate for remote APIs.                      |
| Bound the wait                  | `timeout` sets the deadline; the agent is woken when it passes too.                 | Default 300 s; explicit deadlines 60–600 s. A timed-out wait reports as a failure.           |
| See what is being watched       | The composer's background-work strip lists it with its event count and last event.  | It lists running work; an ended monitor leaves the strip.                                    |
| Stop one                        | The row's Stop button, or the agent's `jobs` tool with `action="stop"`.             | An explicit stop by the user or agent does not start a turn; other endings notify the owner. |
| Inspect recent events           | `jobs` with `action="read"` returns the monitor's bounded event log.                | The log is capped and kept in memory; a restart starts it empty.                             |
| Watch an authenticated endpoint | `${secret:KEY}` in the command; the value is injected into the process environment. | Resolved at start and resume; the displayed command retains the reference.                   |

## How it works

### A trigger and a work record

A monitor is two durable rows, each answering its own question. Its **trigger**
(`features/triggers`) says when it fires: a wait is a `poll` trigger — due at once, then every
interval, with its deadline as a due time of its own — and a watch is a `stream` trigger, which
fires when its process prints. Its **work record** (`features/work`) says that it runs, what it has
seen (`event_count`, `last_event`), and how it ended. The `monitor` trigger action
(`features/monitors/action.ts`) is what a fire does: run the check with the monitor's credentials,
let `poll-step.ts` decide what to report, and report it through `report.ts`.

A watch's lines come from `sources/command.ts` (assembled by `lib/line-splitter.ts`, shared with
plugin monitors). Adding a source means adding a file, not a branch.

### Across a restart

| Kind             | What a restart does                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Wait (`poll`)    | Resumes from its row at its next due time; its work record stays running and the next poll reports. |
| Watch (`stream`) | Ends with `restart`: its process died with the server. The owner is woken once to say so.           |

The poll state kept on the trigger row — how many polls, consecutive failures, and a digest of the
last output for `on_change` — never holds the check's output itself, since that can echo a
credential.

The engine's predicates are `exit_zero`, `contains`, `not_contains`, `regex`, and a numeric bound
with an optional JSON path; the `bash until` wait uses `exit_zero` and leaves the rest of the logic
to the shell (`test`, `grep -q`, `jq -e`). The check's own output becomes the event text, so a wake
carries what the command printed rather than "condition met".

An ordinary nonzero exit keeps the wait pending. A failed pipeline, authentication error or network
failure can therefore look like an unsatisfied condition unless the command distinguishes them. For
a pipeline that should resume the conversation on either success or failure, test for any terminal
state and print its actual conclusion. Inspect that output before reporting the task's result;
satisfying the exit-zero predicate does not establish the business outcome.

An unrunnable check (126, 127 or the runner's `-1` failure signal) ends immediately on the first
poll. If checks stop executing later, four consecutive such failures are tolerated and the fifth
ends with an error; an ordinary nonzero result resets that counter.

Each individual check has its own execution timeout: the poll interval, bounded to 5–30 seconds. The
overall wait deadline does not give one command that whole period to run. Use a short status check
that returns promptly, rather than a command that itself waits for the remote job to finish.

For example, when another process writes a readiness marker in the session's working directory:

```json
{
  "command": "test -f ready.flag",
  "until": 10,
  "timeout": 300,
  "description": "Wait for the readiness marker"
}
```

The first poll is due at once; later polls follow the cadence. The example waits for existence;
choose a stronger command when readiness also depends on the file's contents or a service check.

### From an event to a turn

For a watch, `batch.ts` coalesces lines inside a 200 ms window so one multi-line fact costs one
turn, and stops a monitor that exceeds 60 events per minute — a flood is a mistake in the filter,
and stopping says so rather than hiding it. (A plugin's watch drops the excess instead and keeps
running; see `features/plugins/monitor-stream.ts` for why the two policies differ.) The fire then
wakes the session through the triggers' one delivery path (`features/triggers/delivery.ts`) with the
wake source `bg-monitor`, addressed to the participant that started it and keyed by the fire
(`trg:<id>:<seq>`). A busy session does not lose the event: the wake queue holds it, and the fires
that wait together are one turn.

### Where a monitor is visible

A wait is running work in the session's work registry, so `jobs` lists, reads and stops it exactly
like a background bash job, and its events stream into the same `bash` card in the transcript. Its
event count and latest event are fields of the work record, so the `session_work.updated` push the
composer's background-work strip renders carries them — there is no second strip or opcode for
monitors. Stop goes through the monitor service rather than an action the tool registered: a wait
resumed after a restart has no live tool call. The turn an event opens is a hidden user row carrying
the wake source, so the visible reply is badged **Monitor**.

### Credentials

A wait against an authenticated endpoint names a Vault key instead of carrying a token. The command
holds a `${secret:KEY}` reference — the same grammar mini app settings and saved API requests use —
and the value reaches the process through its ENVIRONMENT:

```text
stored, shown, gated:  curl -sf -H "Authorization: Bearer ${secret:MSGR_TOKEN}" https://msgr/api
executed:              curl -sf -H "Authorization: Bearer $LOCALIX_SECRET_MSGR_TOKEN" …
```

Localix injects the value through an environment variable so the stored command and trigger keep
only the Vault reference. This does not guarantee secrecy from local process inspection: the shell
expands `$LOCALIX_SECRET_MSGR_TOKEN` before invoking `curl`, so its header argument can contain the
value. Access to process arguments and environments depends on the operating system and privileges.
Monitor events and ending details pass through the exposure shield before reaching Localix surfaces.

| Rule                                                                | Reason                                                                                                                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A key missing from the Vault refuses the start and names it.        | A check with an empty credential polls a 401 forever and reports nothing.                                                                                                        |
| The strip shows which keys a watch uses.                            | The value is invisible by design, so the USE has to be visible.                                                                                                                  |
| The value is resolved at start, and again when a restart resumes.   | Each resolve is a Vault audit entry, so it is not repeated per poll; a key deleted during a downtime ends the resumed wait with an error instead of polling without it.          |
| Every event, log line and ending detail passes the exposure shield. | An authenticated check echoes its own header often enough (`curl -v`, a reflecting error body) that a watch's OUTPUT is an exposure path — and a wake is persisted as a message. |
| The resolve is recorded against the monitor.                        | The Vault's activity log answers "which watch used this key", not just "the agent".                                                                                              |

The agent names a Vault key in the command. The `vault` tool returns metadata, and the monitor
resolves the value server-side instead of returning it to the model. This does not isolate Vault
storage from other processes running under the same OS account.

### Permissions

The wait is an ordinary `bash` call. The run's permission gate evaluates its command and paths
against the agent rules after the conversation mode rewrite, including host-root protection and any
matching dangerous-command or outside-workspace rule. Without a live `jobs` tool `bash` carries no
background fields, so no wait can be started.

### Plugin monitors are not agent waits

A plugin manifest's `monitors` field and the agent's `bash until` wait have different owners and
lifecycles, although they share output-line splitting infrastructure.

|               | Manifest `monitors`                                                      | Agent `bash until` wait                                     |
| ------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Started by    | The plugin, for every enabled install                                    | The agent, inside one session                               |
| Scope         | Process-wide; lines wake only the sessions armed via `ctx.host.monitors` | One session, listed in its background-work strip            |
| Lifetime      | The process; restarted on plugin-state change                            | Until its condition, timeout, or a stop; survives a restart |
| Excess output | Dropped with a warning                                                   | The monitor is stopped and says why                         |
| Provenance    | `external`                                                               | `bg-monitor` ("via Monitor")                                |

## Configuration

`bash` fields that shape a wait:

| Field         | Required | Default      | Meaning                                                                                    |
| ------------- | -------- | ------------ | ------------------------------------------------------------------------------------------ |
| `command`     | Yes      | —            | The check; the wait ends when it exits 0                                                   |
| `until`       | Yes      | —            | Requested poll interval (minimum 5 s); clamped so at least four intervals fit the deadline |
| `description` | No       | the command  | Shown in every wake and in the composer strip                                              |
| `cwd`         | No       | Session root | Working directory for the command                                                          |
| `timeout`     | No       | 300 s        | Explicit deadlines 60–600 s; accepted values 1–59 are ignored and use the default          |

Limits include four concurrent monitors per session, a 5 s poll-interval floor, and a watch rate
limit of 60 events in a sliding minute. Watch output uses a 2,000-character line cap; the 61st event
ends that watch. A wake shows at most 20 event entries and reports how many were omitted.

## Limits

- Active monitors cache resolved Vault values for the lifetime of that monitor in the API process.
  Rotating or deleting a key does not replace the cached value on each poll; stop and restart the
  monitor to resolve it again. Resume after an API restart also resolves again.
- A watch's process does not survive an API restart; the restart ends it without waking anyone, and
  it is listed as lost. A polled wait resumes.
- A monitor is not a scheduler. Recurring work belongs to `/loop`; a monitor waits for one thing and
  ends.
- Silence is not success. A filter or predicate that matches only the happy path leaves a crash
  looking exactly like "still waiting"; cover the failure states.
- An explicit stop by the user or agent produces no new turn.
- Stopping a polled wait prevents future reports and checks. A check already running is not
  immediately cancelled; its result is discarded when it finishes within its execution timeout.
- An ended monitor is no longer running work: it leaves the composer strip at once, and `jobs` can
  no longer read it. Its ending wake carries up to 20 pending event entries. Omitted entries cannot
  be recovered with `jobs read` after the monitor ends.

## Related guides

- [Forks](delegation.md)
- [Install Claude Code plugins](../extending/claude-code-plugins.md) — a `bin/` executable lets a
  monitor reach what a plugin already knows how to talk to
- [Send messages into a session](webhook.md)
- [Notifications](notifications.md)

## Source of truth

- [Monitor contracts and wake text](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/contracts.ts)
- [Per-monitor credential cache](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/credentials.ts)
- [Vault reference substitution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/secrets.ts)
- [Start, stop, caps and resume](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/service.ts)
- [What a fire does](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/action.ts)
- [One poll's verdict](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/poll-step.ts)
- [Shield, count, log, wake](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/report.ts)
- [Condition evaluation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/conditions.ts)
- [Coalescing and rate limit](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/batch.ts)
- [Poll and stream trigger kinds](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/triggers/kinds/poll.ts)
- [Command source](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/sources/command.ts)
- [`bash until` → wait spec](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/bash/bash-until.ts)
- [Accepted bash fields and timeout range](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/bash/bash-types.ts)
- [Background deadline normalization](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/bash/bash.ts)
- [Individual check deadline and result suppression](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/monitors/action.ts)
- [Wake queue priority and coalescing](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/wake-queue.ts)
- [Composer strip](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/ui/prompt-input/WorkStrip.tsx)
