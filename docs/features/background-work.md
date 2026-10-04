# Background work

Background work is what a session keeps running after the turn that started it ends: a dev server, a
long build, a watch, a delegated sub-agent. Use this page to see how that work is started, found,
stopped, and reported, and what a restart does to it.

## Terminology

| Term        | Meaning                                                                               | Boundary                                                                   |
| ----------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Job         | A `bash` command running in the background, addressed as `bg-1`, `bg-2`.              | At most 10 run at once per session; the ids are never reused.              |
| Pane        | An interactive terminal (`bash` `action: "open"`), or a server the preview restarted. | A job too: listed as `bg-N` with its terminal id, and counted in the 10.   |
| Monitor     | A wait or watch the session is woken by, addressed as `mon-1`.                        | Described on its own page: [Wait for something to happen](monitors.md).    |
| Sub-agent   | A detached child delegated from the session, addressed as `sub-1`.                    | It does not count toward the job limit.                                    |
| Work record | The durable row every one of these has: what it is, that it runs, how it ended.       | One row per item; the running set is also kept in memory for live actions. |
| Exit notice | The single wake a finished job owes when it was started with `notify`.                | Delivered once; a repeated report of the same exit is the same delivery.   |

## What you can do

| Need                  | Mechanism                                                                               | Boundary                                                                |
| --------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Start a job           | `bash` with `background: true` returns a job id at once; the output streams live.       | A foreground command that outlives its `timeout` is promoted to a job.  |
| Hear when it ends     | `notify: true` wakes the agent with the output when the job finishes.                   | Without it the result is read with `jobs`; nothing wakes the session.   |
| See what is running   | The composer's background-work strip lists jobs, monitors and sub-agents together.      | It shows running work; an item leaves the strip when it ends.           |
| Read or stop one      | `jobs` with `action="list"`, `"read"`, `"stop"` or `"send_input"`, or the strip's Stop. | Stop is a request: a process gets a moment to exit before it is killed. |
| Open a job's terminal | A job started in a terminal pane opens from its strip row.                              | A job without a pane (no terminal host) has only its captured output.   |
| Talk to a sub-agent   | `agents` with `action="message"`, `"stop"` or `"close"` ([Delegation](delegation.md)).  | Every run of a child is listed as `sub-N` and reports back.             |

## How it works

`bash background:true` spawns the process (`agent-core/tools/bash/bash-process.ts`) — a PTY pane
when a terminal host is wired, else a detached child — and registers its live actions with the run's
async registry (`features/chat/runtime/run/async-registry.ts`). The registry records it in the work
registry (`features/work/registry.ts`), which mints the id, writes the durable row and publishes
`session_work.updated`, the event the composer strip renders from. The `jobs` tool, the prompt's
list of running work and the strip all read that one registry through the same owner filter, so none
of them can see a job the others miss.

A pane that is not a bash job registers no live action, so it would reach none of those readers.
Both paths that open one — the agent's interactive terminal (`bootstrap/terminal-ports.ts`) and the
preview's restart route (`features/terminal/routes.ts`) — record it through
`features/terminal/terminal-work.ts`, keyed by its PTY. `jobs` stops and types into such a pane
through the terminal itself, and a closed pane ends as `cancelled`, not `failed`. The output the
prompt and `jobs read` show is the pane's scrollback as plain text.

A job started with `notify` arms an exit notice (`features/chat/runtime/exit-notices.ts`): a
`process-exit` trigger, armed when the process starts, that fires once with the output when it ends.
The same mechanism carries a CC hook's asynchronous rewake.

### Across a restart

| Item      | What a restart does                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| Job       | Its process died with the server: the row becomes `lost`, and its transcript card stops showing it running. |
| Notify    | The notice ends with `restart` and wakes the owner once to say the job was lost.                            |
| Monitor   | A wait resumes from its row; a watch ends with `restart`. See [monitors](monitors.md).                      |
| Sub-agent | Its report is recovered from the finished child, once. See [delegation](delegation.md).                     |

Restarting the desktop app to install an update is such a restart. When any conversation has a turn
in flight or a job, watch, or detached sub-agent running, the app first names what would stop and
installs only after you confirm. A polled monitor is not counted, because it resumes.

## Limits

- Ten running jobs per session, panes included. At the limit `background: true` and `action: "open"`
  are refused before anything starts, and a timed-out foreground command is killed and reported as a
  timeout instead of promoted.
- A pane a background conversation opens does not take focus; it waits in that conversation's strip.
- A job's captured output is bounded and kept in memory; after a restart only its work record and
  final transcript card remain.
- Stopping from the strip does not wake the agent; every other ending of a `notify` job does.

## Related guides

- [Wait for something to happen](monitors.md)
- [Repeat work on a schedule](loops.md)
- [Delegation](delegation.md)

## Source of truth

- [Work registry](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/work/registry.ts)
- [Async registry](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/async-registry.ts)
- [Exit notices](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/exit-notices.ts)
- [Lost work on boot](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/lost-work.ts)
- [The jobs tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/bash/jobs.ts)
- [Panes as work](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/terminal/terminal-work.ts)
- [Background-work strip](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/ui/prompt-input/WorkStrip.tsx)
- [What a restart to update stops](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/model/interruptibleWork.ts)
