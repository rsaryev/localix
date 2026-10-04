# Delegation

`agents { action: "delegate", tasks: [{ agents, title, prompt, priority }] }` explicitly starts one
or more focused child sessions, each run by one agent or by a team. Each prompt is that child's
whole assignment; the parent continues independent work and receives a report **every time a run it
is waiting on finishes or fails** — the delegated task, and each follow-up it sends after it.

Delegation is for isolated execution in a session of its own. When a participant's part belongs in
the shared conversation, schedule that participant with `conversation_control` instead; delegate
when the work needs its own session and context. A detached child's reports are routed back to the
participant who launched it, so the child agent is not started again in the parent conversation
merely to deliver its own result.

## The `delegate` input

One call carries **1–6 tasks**, so a lead that splits work into independent parts says so in one
turn instead of a turn per child. The schema is strict: an unknown field is rejected, and a task
without all four of `agents`, `title`, `prompt` and `priority` is refused before anything starts.

| Task field | Value                                                                        | Boundary                                                              |
| ---------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `agents`   | 1–3 agents by registry id or handle, with or without `@`; several are a team | Each must be enabled and allowed by the [delegation tree](#the-tree). |
| `title`    | A short task name, 1–120 characters                                          | Becomes the child session's title.                                    |
| `prompt`   | The whole assignment: goal, scope, constraints, files and done criteria      | The child sees nothing else.                                          |
| `priority` | `high`, `normal` or `low` — **required**                                     | Orders the queue when children wait for one of the 3 slots.           |

The children are created in the order given; the short settle window each started child is watched
through runs for all of them together, so three tasks cost one window. A task that fails does not
stop the others — the result has one line per task, and is an error only when every task failed.

Priority is required rather than defaulted: a default would make every task `normal` and the queue
an unordered first-come line again. A waiting `high` task takes the next slot that frees; it never
stops a running child to take its place.

## The tree

A child can delegate in turn, so delegation forms a tree. Three rules keep it bounded.

| Rule      | What it allows                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| Ladder    | A conversation involves up to 3 different agents, its child 2, a grandchild 1; the level below none.        |
| No cycles | Never to yourself, and never to an agent that delegated work down to you, directly or further up.           |
| Group     | In a conversation of several participants, only those participants take work. A solo chat uses any profile. |

The ladder counts **different agents** across a session's open children, not tasks; closing a child
frees its agents. An agent that needs its delegator does not delegate back up: it says so in its
report, or addresses it in a conversation they share. Each child learns its own allowance with its
task.

A task for several agents is **one** session with all of them in it — a team. Who leads it is the
same rule that decides who answers first in any conversation: the highest leadership priority. The
team talks inside its session with `@` mentions, and the lead delegates a piece further down when it
needs a fresh context. A team reports once, when its session has gone quiet: no teammate turn queued
and no child of its own still working.

**Seeing is not managing.** `runs` shows a session its whole subtree — every level below it,
indented under its owner, with what each spent and the total — and nothing above it. `message`,
`stop` and `close` act only on its own children; a deeper run answers that only its owner can manage
it. A report goes one level up, to the session that delegated, which integrates it and reports
upward in its own turn.

The context window shrinks with depth as well: a conversation budgets against 256k tokens, its child
128k, and every level below 64k.

## Talking to a child after delegating

The agent that delegated a child keeps a line to it:

| Action                                                              | Effect                                                                                              | Boundary                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `agents { action: "runs" }`                                         | The subtree: status, priority, place in the queue, and what each has spent (tokens and cost).       | Starts nothing.                                                |
| `agents { action: "message", run, message, priority?, interrupt? }` | A running child reads it at its next step; a finished child runs again for it, in the same session. | Queued, not read: the result never claims the child acted yet. |
| `agents { action: "stop", run }`                                    | Requests a stop of the current run of one child or a list. No report follows.                       | The child can still be messaged later.                         |
| `agents { action: "close", run }`                                   | Stops one child or a list and ends them for good: nothing wakes them, their chats turn read-only.   | Irreversible. Transcripts stay readable; no report follows.    |

`run` is the session id or task name that `runs` prints, and it must be this session's own child. A
follow-up on the same task is a message, not a new delegation: the child keeps everything it has
already read and done.

- **`priority`** on a message replaces the task's priority — the delegator restating how urgent the
  work now is — and is kept for the child's later runs; omitted, the delegated priority stands.
- **`interrupt: true`** stops a running child now and restarts it with the message, instead of
  waiting for its next step boundary, which may be a long tool call away. It is for work that has
  become wrong; the run it cuts short sends no report, and the restarted run reports as usual. On an
  idle child it is an ordinary message.
- Every answer to `message` also says what the child has spent so far, so the delegator weighs the
  next message against the bill it adds to.

The message reaches the child framed as coming from whoever wrote its brief, so it amends the
assignment rather than being read as untrusted data, and it tells the child that its final reply
goes back as a report. In the child's transcript the turn that read it carries a **via Delegator**
chip.

### When a child reports

A report is news the delegator asked for, so a run reports only when it **finished or failed while
the delegator was waiting to hear** from it. The delegator waits from the moment it delegates or
sends a message, until one report answers it.

| What happened                                                    | Report                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| The delegated task, or a run answering a delegator message, ends | Yes — completed or failed.                                                |
| The delegator stops the child, or interrupts it                  | No: its own tool result already said so. It stops waiting.                |
| The person presses Stop on the child                             | No. The wait stands: the parent hears once, when the child next finishes. |
| The person talks to the child in its own chat                    | No — that dialog answers the person. A delegator message joining it does. |
| The child is closed                                              | No.                                                                       |

A **closed** child is refused at every door into a run: the delegator's message, the person's send
(the composer shows it read-only), and any wake already queued, which the drain dismisses. The close
writes its mark first, then drops everything waiting — its place in the queue, messages held for it,
its queued wakes — and only then stops the run, so nothing races in between.

A report can prompt another message, so parent and child could keep each other running with nobody
in the loop. Both sides count that chain: at most twelve consecutive self-caused turns open on their
own, and the chain resets when a person writes.

The host resolves each of `agents` by id first, then by handle, in the session's project scope; a
name it cannot resolve fails with `No enabled agent answers to "…"`. The child session carries those
agents, the tightest of their turn limits and all their preloaded skills. The tool appends the
child's contract to the prompt: work within scope, keep the investigation in the child, end with a
report, and treat a later message from the parent as an amendment answered with a new report.

The call watches the child for 1.2 seconds. A child that fails, stops or finishes inside that window
is reported in the same tool result; otherwise the result says it started, and the report arrives
later as its own turn.

Delegation knows nothing about a task board. To hand over a [Kanban](task-board.md) card, the parent
writes the card's `detail` into the brief. The card stays the parent's to complete or block after it
reviews the report, and report recovery never changes a card.

| Mechanism           | Purpose                           | Execution                             |
| ------------------- | --------------------------------- | ------------------------------------- |
| Kanban plugin       | Record and organize a chat's work | Never starts a run                    |
| `agents` `delegate` | Delegate a bounded model task     | Starts one child session explicitly   |
| Background `bash`   | Run a local process               | Starts a managed local job explicitly |

Children do not see the parent conversation. The brief must already contain the objective,
constraints, relevant paths, expected output, and verification requirements. Each message from the
delegator afterwards adds to that brief; it does not replace it.

## Limits: a queue, and a budget per message

| Limit                      | Value                                          | What happens past it                                              |
| -------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Children running at once   | 3 per parent                                   | The next one **waits**: by priority, then first come first served |
| Tasks in one `delegate`    | 6                                              | The call is refused; split it                                     |
| New children, unattended   | 24 since the person's last message in the chat | `delegate` is refused until the person writes again               |
| Self-caused turns in a row | 12 per session                                 | Further wakes queue but do not open a turn until a person writes  |
| Different agents involved  | 3 at depth 0, 2 at depth 1, 1 at depth 2       | Refused; at depth 3 the session is not offered `agents` at all    |

The queue governs every run an agent starts in a child — a new delegation and a message that wakes a
finished child alike. `delegate` over the cap answers that the child is queued, with its position,
and `runs` shows it as `queued (#N)`. A person writing into a child's chat is not queued: the cap
guards against an agent's burst, not against the person.

The budget counts children **created**, not runs: messaging an existing child creates none, so a
long-lived conversation can keep reusing its children indefinitely. It replaced a lifetime cap of 24
per conversation, which every endless chat would eventually hit in ordinary use while doing nothing
sooner about an agent spawning children in one unattended minute. Only a message the person writes
resets it — a wake or a child's report does not.

Three lanes are an upper bound, not an instruction to fill them: delegate concurrently only when
briefs are independent. Architecture or contract work precedes its implementation, and QA follows
the implementation it verifies. Delegated agents share the parent workspace, so parallel editing
assignments must use disjoint files or coordinate changes.

## Progress and report delivery

`agents` `runs` lists each delegated run of the subtree with its task name, status, session, agent,
spend, last update, public progress, and report availability. Progress comes from public assistant
text or the last observed tool name, never private reasoning or full tool output. Active-child
summaries belong to volatile runtime context, not the cache-stable instructions.

While any of its runs is in progress — the delegated one, or one a message or the person started — a
child is background work of the session that delegated it: the composer's background-work strip and
the `jobs` tool list it as `sub-N`, and Stop there (or `agents` `action: "stop"`) stops that run.
The record opens when the run starts and ends with its outcome (succeeded, failed, or cancelled), or
as lost when the process running it exits first. A child waiting in the queue has no record yet;
`runs` shows it as queued.

Each run's report is decided at its own end, from the one seam every run passes exactly once. Each
report has its own delivery key (the child and the run's final assistant message), and the live and
recovery paths send the same one. The report wake asks for a durable receipt, which is written in
the same transaction as queue admission; replaying a report after acknowledgement does not enqueue
another turn.

A startup and periodic recovery pass re-sends the missing report of a child's latest run for every
user, without rerunning it, routes it to the original parent participant, and bounds the text with a
transcript link. A report decided against is recorded under its key too, so recovery never sends
what the live path chose not to.

Receipts are kept for seven days, and recovery considers only children that ended inside that
window, so a pruned receipt never causes a second report. When the parent is already running, a
child report waits for its own review turn. It is never injected as a mid-response user
interjection, which keeps the original assistant row owned by the run that created it.

A completed run is not proof that the requested outcome is ready. The parent must review the report
against the brief's done criteria before it calls the work done, and completes or blocks any card it
tracks for it. Background Preview hosts are released after the child settles; previews opened by the
user remain available.

Implementation:
[the `agents` tool](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/agents.ts),
[task delegation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/task-delegation.ts),
[the delegation tree](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/delegation-hierarchy.ts),
[runtime wiring](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/task-delegation-options.ts)
and
[per-run reports](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/child-run-report.ts).
