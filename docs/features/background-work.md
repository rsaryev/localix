# Background work

Background work is what a session keeps running after the turn that started it ends: a dev server, a
long build, a watch, a delegated sub-agent. Use this page to see how that work is started, found,
stopped, and reported, and what a restart does to it.

## Terminology

| Term        | Meaning                                                                               | Boundary                                                                                        |
| ----------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Job         | A `bash` command running in the background, addressed as `bg-1`, `bg-2`.              | Starting a job checks the session’s running work; see Limits for the shared count.              |
| Pane        | An interactive terminal (`bash` `action: "open"`), or a server the preview restarted. | Listed as `bg-N` with its terminal id and counted when starting another job.                    |
| Monitor     | A wait or watch the session is woken by, addressed as `mon-1`.                        | Described on its own page: [Wait for something to happen](monitors.md).                         |
| Sub-agent   | A detached child delegated from the session, addressed as `sub-1`.                    | It does not count toward the job limit.                                                         |
| Work record | The durable row every one of these has: what it is, that it runs, how it ended.       | One row per item; the running set is also kept in memory for live actions.                      |
| Exit notice | The wake armed for a job started with `notify`.                                       | Repeated exit reports reuse one delivery identity; delivery is not proof of a successful reply. |

## What you can do

| Need                  | Mechanism                                                                                      | Boundary                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Start a job           | `bash` with `background: true` streams output and returns after a brief initial-output window. | An eligible local foreground command can be promoted after its timeout.                                  |
| Hear when it ends     | `notify: true` requests an agent wake with the output when the job finishes.                   | If notice creation fails, completion falls back to a reminder; without notify, it does not start a turn. |
| See what is running   | The composer's background-work strip lists jobs, monitors and sub-agents together.             | It shows running work; an item leaves the strip when it ends.                                            |
| Read or stop one      | `jobs` with `action="list"`, `"read"`, `"stop"` or `"send_input"`, or the strip's Stop.        | Stop is a request: a process gets a moment to exit before it is killed.                                  |
| Open a job's terminal | A job started in a terminal pane opens from its strip row.                                     | If PTY creation fails or no terminal host exists, the job has only its captured transcript output.       |
| Talk to a sub-agent   | `agents` with `action="message"`, `"stop"` or `"close"` ([Delegation](delegation.md)).         | Every run of a child is listed as `sub-N` and reports back.                                              |

## Manage live work

List work before referring to an id:

```json
{ "action": "list" }
```

Use the returned `job_id` with `jobs`, for example:

```json
{ "action": "stop", "job_id": "bg-1" }
```

**Stop requested** confirms that the registered action was invoked, not that the process has exited.
List again to check whether it remains in the running registry. An item without a stop action can
refuse the request; manage listed sub-agents through `agents`.

```json
{ "action": "send_input", "job_id": "bg-1", "input": "status\n" }
```

Input is raw text: include a newline when the program expects one. **Input sent** does not confirm
that the program consumed it, and an exited process can discard the write. Read its output or use
the terminal screen to confirm the result. A monitor or another item without an input action refuses
it.

`list` and `read` have effect `read`; stopping this conversation's work has effect `session` and is
irreversible; `send_input` has effect `external`. Agent permission rules still apply to each call.
Ownership does not turn arbitrary commands written into a live terminal into read-only actions.

## How it works

`bash background:true` spawns the process (`agent-core/tools/bash/bash-process.ts`) — a PTY pane
when a terminal host is wired, else a detached child — and registers its live actions with the run's
async registry (`features/chat/runtime/run/async-registry.ts`). The registry records it in the work
registry (`features/work/registry.ts`), which mints the id, writes the durable row and publishes
`session_work.updated`, the event the composer strip renders from. The `jobs` tool, the prompt's
list of running work and the strip all use that registry and the same user/session ownership
boundary. This lists work owned by the session, including its participants; it does not expose
another session's jobs. Listing an item does not guarantee that it supports every `jobs` action.

The agent's interactive terminal (`bootstrap/terminal-ports.ts`) and the preview's restart route
(`features/terminal/routes.ts`) record panes through `features/terminal/terminal-work.ts`, keyed by
its PTY. `jobs` stops and types into such a pane through the terminal itself, and a closed pane ends
as `cancelled`, not `failed`. The output the prompt and `jobs read` show is the pane's scrollback as
plain text.

A job started with `notify` arms an exit notice (`features/chat/runtime/exit-notices.ts`): a
`process-exit` trigger, armed when the process starts, that fires once with the output when it ends.
The same mechanism carries a CC hook's asynchronous rewake.

### Across a restart

| Item      | What a restart does                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------- |
| Job       | Localix does not reattach it: its stored running row becomes `lost`, and its transcript card is settled. |
| Notify    | The notice ends with `restart` and wakes the owner once to say the job was lost.                         |
| Monitor   | A wait resumes from its row; a watch ends with `restart`. See [monitors](monitors.md).                   |
| Sub-agent | Its report is recovered from the finished child, once. See [delegation](delegation.md).                  |

Restarting the desktop app to install an update is such a restart. The confirmation uses the UI's
loaded session roster: it counts top-level turns in flight and work items whose kind is not
`monitor`. All monitor rows are excluded, including stream watches whose processes end on restart.
An empty counted set starts installation without that confirmation; it is not proof that no work
will be interrupted. Review and stop important background work before restarting.

### Job deadlines

For `background: true`, omitting `timeout` or supplying an accepted value below 60 seconds leaves
the job without a deadline. Values 60–600 seconds set a job deadline. A foreground command normally
defaults to 60 seconds; promotion requires background support and a local detached process, with
room under the session's job limit. Promotion keeps that process running without reusing the expired
foreground timeout as its new deadline.

## Limits

- Starting a background bash job, opening an agent terminal, or promoting a timed-out command checks
  a limit of ten running work items in the session. This count includes monitors, panes, and other
  registered background work; detached sub-agents are excluded. At the limit a new job or agent
  terminal is refused, and a timed-out command is killed instead of promoted. Monitor creation has
  its own four-monitor limit, so ten is not a universal cap on all work.
- A pane a background conversation opens does not take focus; it waits in that conversation's strip.
- `jobs read` reads a running monitor's event log or a job's terminal scrollback. A child-process
  bash job without a terminal cannot be read that way; inspect its transcript card. Finished work
  leaves the running registry and is no longer accessible through `jobs`.
- Captured output is bounded. A background job can spill large final output to a temporary file, and
  model-facing output may be summarized or clipped. After a restart live actions and in-memory
  capture are gone; the stored work record and transcript remain.
- Work-row writes happen asynchronously and log failures. An interrupted or failed write can leave
  restart recovery without a complete record.
- Stopping with `jobs stop`, the strip, or a tool card does not start an agent turn. Other endings
  of a `notify` job use its armed notice; if notice creation failed, completion falls back to a
  reminder for a subsequent tool result.

## Related guides

- [Wait for something to happen](monitors.md)
- [Repeat work on a schedule](loops.md)
- [Delegation](delegation.md)

## Source of truth

- [Work registry](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/work/registry.ts)
- [Async registry](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/async-registry.ts)
- [Exit notices](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/exit-notices.ts)
- [Lost work on boot](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/lost-work.ts)
- [Background result and notification handling](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/background-emitter.ts)
- [Background deadlines and dispatch](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/bash/bash.ts)
- [Foreground job promotion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/bash/bash-promote.ts)
- [The jobs tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/bash/jobs.ts)
- [Panes as work](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/terminal/terminal-work.ts)
- [Background-work strip](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/ui/prompt-input/WorkStrip.tsx)
- [What a restart to update stops](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/model/interruptibleWork.ts)
