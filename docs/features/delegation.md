# Forks

An agent creates child work in one way: it **forks itself**. `fork { title, task }` continues the
speaking agent, with the same role, in a child session that starts with a copy of the conversation
as of the call. The fork knows everything its original knew, so the task needs no self-contained
brief. It works in parallel while the original continues, and its final reply returns to the
original as a report.

Agents fork to keep their own context clean: searches and investigations, long tasks, and work that
is independent of the critical path run in the fork, and only the fork's report comes back for the
original to integrate.

Agents do not hand work to other agents. When another role is needed, invite that colleague into the
conversation by tagging them with the assignment, so they work where the person can see and redirect
them. See [Conversations](conversations.md).

`fork` is **on by default** for every shipped agent. Only a root chat can fork; a fork, a job or a
forked skill cannot. A fork cannot fork again: an agent that needs more help reports the blocker in
its final reply.

## What a fork inherits

A fork copies the **current topic** of the conversation, keeping each message's author, so the
forked agent keeps its own tool history and sees colleagues' public text, as it did before. Earlier
topics, notices and the forking turn's own unfinished reply are not copied. The fork is told that
earlier requests in the copy were already handled by its original, that earlier approvals do not
carry over, and that it should do only the task it was given.

A fork runs under the conversation's permission mode, in the same workspace. Parallel edits must
therefore use disjoint files or coordinate their changes.

A fork appears under its conversation like any child session, in the sidebar and in the composer's
**Agent sessions** panel, where you can open it and talk to it directly.

## The `fork` input

| Call                                                   | Effect                                                                                            | Boundary                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `fork { title, task }`                                 | Starts a fork. `task` is the goal and when it is done; `title` is a short name.                   | Admitted against the limits below.                            |
| `fork { action: "list" }`                              | This session's forks: status, place in the queue, spend (tokens and cost) and public progress.    | Starts nothing. Not for polling.                              |
| `fork { action: "message", run, message, interrupt? }` | A running fork reads it at its next step; a finished fork runs again for it, in the same session. | Queued, not read: the result never claims the fork acted yet. |
| `fork { action: "stop", run }`                         | Requests a stop of the current run of one fork or a list. No report follows.                      | The fork can still be messaged later.                         |
| `fork { action: "close", run }`                        | Stops one fork or a list and ends them for good: nothing wakes them, their chats turn read-only.  | Irreversible. Transcripts stay readable; no report follows.   |

`run` is the session id or task name that `list` prints, and it must be one of this session's own
forks. A follow-up on the same task is a message, not a new fork: the fork keeps everything it has
already read and done.

- **`interrupt: true`** stops a running fork now and restarts it with the message, instead of
  waiting for its next step boundary, which may be a long tool call away. It is for work that has
  become wrong; the run it cuts short sends no report, and the restarted run reports as usual. On an
  idle fork it is an ordinary message.
- Every answer to `message` also says what the fork has spent so far, so the original weighs the
  next message against the bill it adds to.

The message reaches the fork as an amendment to its task, and tells it that its final reply goes
back as a report.

The call watches a new fork for 1.2 seconds. A fork that fails, stops or finishes inside that window
is reported in the same tool result; otherwise the result says it started, and the report arrives
later as its own turn, headed **[Your fork finished]**.

## When a fork reports

A report is news the original asked for, so a run reports only when it **finished or failed while
the original was waiting to hear** from it. The original waits from the moment it forks or sends a
message, until one report answers it.

| What happened                                         | Report                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| The forked task, or a run answering a `message`, ends | Yes — completed or failed.                                               |
| The original stops the fork, or interrupts it         | No: its own tool result already said so. It stops waiting.               |
| The person presses Stop on the fork                   | No. The wait stands: the parent hears once, when the fork next finishes. |
| The person talks to the fork in its own chat          | No — that dialog answers the person. A `message` joining it does.        |
| The fork is closed                                    | No.                                                                      |

A **closed** fork is refused at every door into a run: the original's message, the person's send
(the composer shows it read-only), and any wake already queued, which the drain dismisses.

A report can prompt another message, so parent and fork could keep each other running with nobody in
the loop. Both sides count that chain: at most twelve consecutive self-caused turns open on their
own, and the chain resets when a person writes.

## Limits: a queue, and a budget per message

| Limit                      | Value                                          | What happens past it                                      |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| Children running at once   | 3 per parent                                   | The next one **waits**, first come first served           |
| New children, unattended   | 24 since the person's last message in the chat | `fork` is refused until the person writes again           |
| Fork depth                 | 1                                              | A fork cannot fork; only root chats are offered `fork`    |
| Self-caused turns in a row | 12 per session                                 | Further wakes wait for a turn caused by an external event |

The queue governs every run an agent starts in a child — a new fork and a message that wakes a
finished fork alike. A fork over the cap is reported as queued with its position, and `list` shows
it as `queued (#N)`. A person writing into a fork's chat is not queued. Lane scheduling and messages
waiting for a lane live in process memory; restarting the server does not restore those queues.

The budget counts children **created**, not runs: messaging an existing fork creates none. Only a
message the person writes resets it. The context window shrinks with depth as well: a conversation
budgets against its full policy window, its child against at most 128k and every level below against
64k.

## Progress and report delivery

While any of its runs is in progress, a fork is background work of the session that started it: the
composer's background-work strip and the `jobs` tool list it as `sub-N`, and Stop there (or `fork`
`action: "stop"`) stops that run. Progress comes from public assistant text or the last observed
tool name, never private reasoning or full tool output.

Each run's report has its own delivery key (the child and the run's final assistant message), and
the live and recovery paths send the same one. The report wake asks for a durable receipt, written
in the same transaction as queue admission, so a replay never enqueues another turn. A recovery pass
at startup re-sends the missing report of a child's latest run without rerunning it, routes it to
the participant that forked, and bounds the text with a transcript link. Receipts are kept for seven
days.

When the parent is already running, an eligible report can join the forking participant's next model
request after a fully completed tool turn; disabling `LOCALIX_MID_RUN_INTERJECT` keeps reports on a
separate turn. A completed fork is not proof that the requested outcome is ready: the original
reviews the report before it calls the work done.

## Skills that run in a child session

A skill with `context: fork` in its frontmatter, invoked by the person as a slash command, runs in a
child session of its own as the agent that invoked it: in a group, the participant the command
addressed; in a direct chat, the conversation's agent. Its `model:` and `effort:` fields still
choose that child's model and reasoning effort. Its `agent:` field is no longer honoured: no path
starts a different agent on a skill's or an agent's behalf. Validation warns about the field, and
the command's reply says it was ignored. See [Skills authoring](../extending/skills-authoring.md).

## Older conversations

Before forks became the only agent-created child work, agents could delegate tasks to other agents
with an `agents` tool. Conversations from that time stay readable: their `agents` calls render as
historical tool cards, and their delegated child sessions still appear beneath the parent. You can
open such a child and write to it, and its reports still reach the parent. Agents cannot message,
stop or close those older children through `fork`.

## Source of truth

- [Fork tool and input schema](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/fork.ts)
- [Fork creation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/agent-fork.ts)
- [Fork message, stop, close and list](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/fork-control.ts)
- [Fork port wiring](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/fork-options.ts)
- [Conversation copy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/fork-conversation.ts)
- [Child-session host](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/task-delegation-options.ts)
- [Creation budget](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/delegation-budget.ts)
- [In-memory lane queue](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/delegation-lanes.ts)
- [Per-run reports](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/child-run-report.ts)
- [Report wording](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/delegation-report.ts)
- [Self-wake budget](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/wake-queue/self-wake-budget.ts)
