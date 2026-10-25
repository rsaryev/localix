# Delegation

An agent hands a task to a child session with **`delegate`**. `delegate { title, task }` runs the
task in a child session as the delegating agent itself; `agent` gives it to another enabled agent
from the directory instead. The child works in parallel while the delegator continues, and its final
reply returns to the delegator as a report.

Agents delegate to keep their own context clean: searches and investigations, reviews, long tasks,
and work that is independent of the critical path run in the child, and only the child's report
comes back for the delegator to integrate.

A child session is for a self-contained task whose report is all the conversation needs. When a role
owns a part of the goal, invite that colleague into the conversation by tagging them with the
assignment instead, so they work where the person can see and redirect them. See
[Conversations](conversations.md).

`delegate` is **on by default** for every shipped agent. Only a root chat can delegate; a child, a
job or a forked skill cannot. A child cannot delegate again, so a tree is one level deep and agents
cannot hand work to each other in a chain: a child that needs more help reports the blocker in its
final reply.

## What a child sees

By default a child starts from **the task alone** (`context: "none"`): it is told which agent
delegated the task, that its final reply is reported back, and nothing else. State everything it
needs in `task`.

`context: "conversation"` adds the **current topic** of the conversation, reduced to what the person
and the delegating agent said:

| Copied                                                     | Not copied                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| The person's messages, with attachments and linked context | A command's invocation instruction                                  |
| The delegating agent's replies, as their text              | Its tool calls, tool results and reasoning                          |
|                                                            | Other participants' messages, system wakes, notices, earlier topics |
|                                                            | The delegating turn's own unfinished reply                          |

The child is told that the copied requests were already handled, that other participants' roles and
tasks are not its own, and that earlier approvals do not carry over.

A child runs under the conversation's permission mode, in the same workspace. Parallel edits must
therefore use disjoint files or coordinate their changes. Another agent is admitted only when its
policy allows the `delegation` invocation host; it runs with its own instructions and model.

A child appears under its conversation like any child session, in the sidebar and in the composer's
**Agent sessions** panel, where you can open it and talk to it directly.

## Blocking and non-blocking

| Mode                   | The call                                                             | The report                                                          |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Non-blocking (default) | Returns at once: started, queued, or an outcome from the first 1.2 s | Arrives later as its own turn, headed **[Delegated task finished]** |
| `wait: true`           | Holds the delegator's turn until the child's run ends                | Returned as the call's result; no separate report is sent           |

Use `wait: true` only when the delegator's very next step needs the result. A waiting call ends
after ten minutes at most; the child keeps working, and its report then arrives as a message, as in
the non-blocking mode. A child that stops while the call waits ends the wait with that outcome. Stop
on the conversation ends the waiting call and, as for any run, stops the children it spawned; no
report follows.

## The `delegate` input

| Call                                                       | Effect                                                                                                                                 | Boundary                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `delegate { title, task, agent?, context?, wait? }`        | Starts a child. `task` is the goal and when it is done; `title` is a short name.                                                       | Admitted against the limits below.                                                           |
| `delegate { …, model?, effort?, isolation? }`              | Sets the child's model (an alias such as `haiku` or an id), its reasoning effort, or `isolation: "worktree"` for a fresh git worktree. | A call's model and effort win over an agent type's own; a host's model wins over the call's. |
| `delegate { action: "list" }`                              | This session's children: status, place in the queue, spend (tokens and cost) and public progress.                                      | Starts nothing. Not for polling.                                                             |
| `delegate { action: "message", run, message, interrupt? }` | A running child reads it at its next step; a finished child runs again for it, in the same session.                                    | Queued, not read: the result never claims the child acted yet.                               |
| `delegate { action: "stop", run }`                         | Requests a stop of the current run of one child or a list. No report follows.                                                          | The child can still be messaged later.                                                       |
| `delegate { action: "close", run }`                        | Stops one child or a list and ends them for good: nothing wakes them, their chats turn read-only.                                      | Irreversible. Transcripts stay readable; no report follows.                                  |

`agent` is an agent's name (or id); omitted, the delegating agent runs the task itself. `run` is the
session id or task name that `list` prints, and it must be one of this session's own children. A
follow-up on the same task is a message, not a new child: the child keeps everything it has already
read and done.

- **`interrupt: true`** stops a running child now and restarts it with the message, instead of
  waiting for its next step boundary, which may be a long tool call away. It is for work that has
  become wrong; the run it cuts short sends no report, and the restarted run reports as usual. On an
  idle child it is an ordinary message.
- Every answer to `message` also says what the child has spent so far, so the delegator weighs the
  next message against the bill it adds to.

The message reaches the child as an amendment to its task, and tells it that its final reply goes
back as a report.

## When a child reports

A report is news the delegator asked for, so a run reports only when it **finished or failed while
the delegator was waiting to hear** from it. The delegator waits from the moment it delegates or
sends a message, until one report answers it.

| What happened                                            | Report                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| The delegated task, or a run answering a `message`, ends | Yes — completed or failed.                                                |
| The delegator stops the child, or interrupts it          | No: its own tool result already said so. It stops waiting.                |
| The person presses Stop on the child                     | No. The wait stands: the parent hears once, when the child next finishes. |
| The person talks to the child in its own chat            | No — that dialog answers the person. A `message` joining it does.         |
| The child is closed                                      | No.                                                                       |

A **closed** child is refused at every door into a run: the delegator's message, the person's send
(the composer shows it read-only), and any wake already queued, which the drain dismisses.

A report can prompt another message, so parent and child could keep each other running with nobody
in the loop. Both sides count that chain: at most twelve consecutive self-caused turns open on their
own, and the chain resets when a person writes.

## Limits: a queue, and a budget per message

| Limit                      | Value                                          | What happens past it                                          |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Children running at once   | 3 per parent                                   | The next one **waits**, first come first served               |
| New children, unattended   | 24 since the person's last message in the chat | `delegate` is refused until the person writes again           |
| Delegation depth           | 1                                              | A child cannot delegate; only root chats are offered the tool |
| Self-caused turns in a row | 12 per session                                 | Further wakes wait for a turn caused by an external event     |
| A waiting call             | 10 minutes                                     | The wait ends; the report arrives as a message                |

The queue governs every run an agent starts in a child — a new child and a message that wakes a
finished child alike. A child over the cap is reported as queued with its position, and `list` shows
it as `queued (#N)`. A person writing into a child's chat is not queued. Lane scheduling, messages
waiting for a lane and waiting calls live in process memory; restarting the server does not restore
them.

The budget counts children **created**, not runs: messaging an existing child creates none. Only a
message the person writes resets it. The context window shrinks with depth as well: a conversation
budgets against its full policy window, its child against at most 128k and every level below against
64k.

## Progress and report delivery

While any of its runs is in progress, a child is background work of the session that started it: the
composer's background-work strip and the `jobs` tool list it as `sub-N`, and Stop there (or
`delegate` `action: "stop"`) stops that run. Progress comes from public assistant text or the last
observed tool name, never private reasoning or full tool output.

Each run's report has its own delivery key (the child and the run's final assistant message), and
the live and recovery paths send the same one. The report wake asks for a durable receipt, written
in the same transaction as queue admission, so a replay never enqueues another turn. A report a
waiting call took is recorded under the same key, so recovery does not send it again. A recovery
pass at startup re-sends the missing report of a child's latest run without rerunning it, routes it
to the participant that delegated, and bounds the text with a transcript link. Receipts are kept for
seven days.

Reports to one delegator arrive together, so a delegator that handed out several tasks answers once.
While it is idle, a finished child's report waits in its queue as long as the delegator's other
children still owe a report. The composer lists it as "Waits for other reports". The last report
releases them all as one message, with each child's report numbered.

A child that is stopped or closed owes nothing and releases the others. A report waits five minutes
at most, so a child that runs for an hour does not keep finished work from its delegator.

When the parent is already running, the reports addressed to the delegating participant join its
next model request together, after a fully completed tool turn. Disabling
`LOCALIX_MID_RUN_INTERJECT` keeps them for a separate turn. A completed child is not proof that the
requested outcome is ready: the delegator reviews the report before it calls the work done.

## Claude Code agent types

`agent` names an agent from the one catalog every surface reads (see [Agents](agents.md)):

- **Agent files**: yours (`~/.claude/agents/`), the project's (`.claude/agents/` in the working
  directory and each parent up to the repository root, the closest definition of a name winning),
  managed ones and a plugin's `agents/*.md` (`<plugin>:<name>`), named by their `name` front matter.
  A file without a `name` or a `description` is skipped.
- **A child is that agent**: a fresh run of the named agent on its own prompt, tool ceiling,
  instruction files, model and skills, as in Claude Code, subject to its Access rules. An agent
  whose Access denies `Agent(<name>)` is hidden from the directory and refused.
- **Built-in types**: `general-purpose` and `claude` run the task as the delegating agent itself;
  `Explore` and `Plan` run it read-only, without the project's instruction files. An agent file
  named `Explore` or `Plan` replaces the built-in.
- **Memory**: `memory: user | project | local` gives an agent a folder
  (`~/.claude/agent-memory/<name>/`, `.claude/agent-memory/<name>/` or
  `.claude/agent-memory-local/<name>/`) whose `MEMORY.md` — its first 200 lines or 25KB — joins its
  instructions, with the file tools to keep it.

The prompt has one `# Agent directory`, listing the agents a tag can reach and those `delegate` can
hand a task to, with their tool lists. Hooks see the agent's name as `agent_type`, or
`general-purpose`.

In an agent's `tools`, `Agent` and `Task` mean `delegate`. An agent type whose `tools` list names no
tool available here is refused instead of starting with none.

## Skills that run in a child session

A skill with `context: fork` in its frontmatter, invoked by the person as a slash command, runs in a
child session of its own as the agent that invoked it: in a group, the participant the command
addressed; in a direct chat, the conversation's agent. Its `model:` and `effort:` fields still
choose that child's model and reasoning effort. Its `agent:` field is not honoured: a skill always
runs as the agent that invoked it. Validation warns about the field, and the command's reply says it
was ignored. See [Skills authoring](../extending/skills-authoring.md).

## Source of truth

- [Delegate tool and input schema](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/delegate.ts)
- [Child creation and waiting](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/delegate-start.ts)
- [Message, stop, close and list](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/delegate-control.ts)
- [Delegate port wiring](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/delegate-options.ts)
- [Conversation context](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/delegate-context.ts)
- [Child-session host](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/task-delegation-options.ts)
- [Report waits](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/delegation-awaits.ts)
- [Creation budget](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/delegation-budget.ts)
- [In-memory lane queue](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/delegation-lanes.ts)
- [Per-run reports](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/child-run-report.ts)
- [Report wording](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/delegation-report.ts)
- [Self-wake budget](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/wake-queue/self-wake-budget.ts)
