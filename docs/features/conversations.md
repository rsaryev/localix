# Conversations with several agents

A conversation is one session with one shared public transcript. Its behavior follows its active
participants: one agent uses direct conversation behavior, while two or more agents use the
multi-participant strategy. Adding or removing an agent does not create another session or rewrite
its history.

![Team Lead, Frontend and QA sharing a release review in one conversation](../assets/screenshots/conversations/participants--2026-10-09.png)

_Demo workspace captured on 9 October 2026 with a seeded conversation. It shows the participant
controls, not a recorded model run._

## Addressing

In a message you send, `@handle` asks that active participant to respond. Handles are
case-insensitive: `@QA` addresses `@qa`. Repeating a handle does not create duplicate turns, and
naming an agent outside the conversation does not invite it. Several addresses select those
participants in roster order, rather than the order of mentions in the message.

`@all` selects every active participant. If the message also names individual participants, those
explicitly addressed agents are queued first; the remaining participants follow as broadcast turns.

Without an address, the strategy chooses one participant from the public history. Before any
participant has published a public answer, the highest leadership priority wins; ties keep roster
order. That election reads current agent settings. Later unaddressed messages return to the last
public answer's author when that author is still present and their answer is the last history row.
Otherwise the participant whose latest assistant row is oldest answers; someone with no assistant
row comes first. Changing leadership priority affects a future election, not this continuity rule.

The leader is instructed to pass work that belongs to another participant through
`conversation_control`. Role matching is an agent instruction; the scheduler does not inspect the
message's subject to choose a specialist automatically.

An agent's public `@handle` is not a new scheduling command. Agents can quote a colleague, publish a
score table, or list the participants without accidentally starting another round. A recognized bare
handle is displayed as an agent chip too. Either reference may slightly promote that colleague only
when the colleague already has a positive-weight pending turn.

## Passing work between agents

A turn that starts with two or more participants and has `conversation_control` must finish with one
successful call. Write the public reply or handoff before calling it: success ends the turn. The
call validates `next` against the proposed roster before saving membership, then queues the
requested participants. An unavailable next participant refuses the call without saving that roster.

- `next: ["qa"]` adds QA to the pending queue.
- `invite: ["qa"], next: ["qa"]` adds QA to the conversation and immediately schedules it.
- `invite: ["qa"], next: []` only adds QA; it does not start QA's work.
- Agents cannot remove participants. Use the composer to remove someone yourself.
- Handles work with or without `@`; immutable agent IDs work too. Use the exact spelling from the
  roster: tool references are case-sensitive, unlike mentions in a user message.
- Ordinary handoffs cannot schedule their own author. Invitations keep every existing participant.

Public text and queue control are independent. The transcript stores public text once, while tool
calls, tool results, reasoning and private notes remain in the author's own agent lane.

The user-visible transcript retains public text, plans and tool activity when a turn finishes, even
without a final text reply. Successful conversation-control calls are hidden individually; they do
not hide other actions in the same message. Failed or interrupted control calls remain visible. Only
turns with no text, plan or other tool activity can be hidden as silent acknowledgements.

Creating or assigning tasks and inviting participants are not execution. When the user asks for
work, the agent is instructed to act, explicitly hand off with the necessary public context, or
explain a concrete blocker. With `next: []` and no already queued or running work, the conversation
is idle; no timer automatically starts the backlog. The scheduler follows explicit requests rather
than inferring work from task titles, assignments or elapsed time.

A solo agent is told only what its inviting turn needs: publish the assignment, then name the
colleague in both `invite` and `next`. The full turn protocol applies from the first turn that
starts with two or more agents, the same membership snapshot that decides whether the call is
required. The protocol sits in the cached part of the system prompt and the participant roster in
the per-turn tail, so an invite does not rewrite the cached prefix. When to do the work yourself,
delegate a board card or invite a colleague is one `# Collaboration` rule.

For dependent work, the leader records the dependency on the board and schedules only the next
participant whose task is actionable. Results move through the chain one owner at a time. Status
broadcasts to the whole roster create redundant turns and are explicitly discouraged.

The `# Collaboration` rule follows the conversation. Alone, an agent does the work itself and
invites a suitable colleague when another role is needed. [Delegation](delegation.md) is off by
default in agent presets and can be enabled through the agent’s tool capabilities for root chats.
Once colleagues are present, every participant — not only the leader — does its own part and hands a
colleague's ready card to them with `conversation_control`, so the work happens where you can see
and redirect it. When enabled, delegation automatically invites its assignees into the parent chat
and executes their tasks in child sessions. Invitation alone does not schedule a duplicate turn
here.

The leader coordinates and does not do a colleague's part. Work that depends on a decision you have
not made yet, such as approving a mockup, waits for it. Whoever scheduled or delegated a piece of
work receives its report and ends with the outcome or the decision it needs from you.

Your change requests and any checks a report left unverified go back to the owner or QA. When you
ask for the team in a one-agent conversation, the agent routes the parts to roles instead of
finishing the work alone. For a new screen, flow or visible redesign the designer's first
deliverable is a rendered mockup opened in the visible preview, and implementation starts after you
approve it; a small change to an existing screen goes straight to the engineer.

`conversation_control` is also available in a one-agent conversation to change the topic or invite a
specialist. [Fixed participants](#fixing-the-participants) prevent invitations. In a multi-agent
conversation the runtime gives the model up to two repair turns if it omitted the required call. If
the call is still missing, the run fails. Repair text replaces the earlier draft only when it
contains meaningful prose; whitespace preserves the earlier public answer. A second completed call
in the same turn is refused. Because this is the terminal protocol for a chat turn, per-agent
capability rules cannot disable it.

Membership, topic changes, and queue admission are separate writes. A queue or publication failure
can leave a saved membership change in place even when the tool fails; earlier recipients may also
have been queued. Inspect the current roster and queue before retrying. A successful `next: []` adds
no turns and does not cancel work already waiting.

## The shared queue

All execution requests use the same durable queue infrastructure. User messages, agent requests,
jobs, timers and sub-agent results provide a typed source and an execution address; the producer
does not choose a numeric priority.

The queue runs work in bands, lowest first:

| Band                       | What                                                     |
| -------------------------- | -------------------------------------------------------- |
| Answers owed to the person | The addressed, default and `@all` turns of their message |
| The person's next message  | A message sent while the session was busy                |
| A colleague chain          | One participant handing the floor to another             |
| Machine wakes              | Loops, background jobs, reports, hooks                   |

A message you send during a long handoff chain therefore runs before the rest of the chain. Waiting
turns gain priority each time another agent is dispatched, but only inside their band: a chain never
ages past your next message. The queue merges duplicate pending turns for the same agent; the
stronger request's settings win and the reply lands after the newest message it answers. Each
explicit `@handle` in agent text adds a `0.10` promotion to an eligible pending answer; each
recognized bare handle adds `0.05`. References never create a ticket.

A chain of handoffs is bounded: after twelve handoffs in a row without a message from you, nobody
else is queued and a notice says the conversation is back with you.

Execution is serial inside one session and may run concurrently across different sessions. Empty
queues park their session dispatcher. They do not complete, archive or otherwise close the session.
Pending rows and their ordering survive process restart.

A visible user message can steer an already running response when it names nobody, the running
agent, or `@all`. "@qa stop" typed while @backend works waits for its own turn with @qa. A parent's
message can also amend its running delegated child's brief at a step boundary.

An eligible child report can join its delegator's next model request after a fully completed tool
turn, at most one report per tool boundary. Group chats require the report to address the current
speaker; a solo chat can also take an unaddressed report. Other reports, webhooks and loops wait for
a separate turn. The host waits for tool-checkpoint settlement before splitting the assistant row;
see [Delegation](delegation.md#progress-and-report-delivery). Disabling `LOCALIX_MID_RUN_INTERJECT`
keeps these queued messages and reports for later turns.

A slash command sent while the session is busy waits in the queue as a whole command — with its
badge, model and tool grants — and runs as its own turn.

## What each agent sees

Every agent reads the public messages with immutable author attribution. Each agent also receives
its own reasoning, tool activity, addressed runtime events and its own checkpointed view. It does
not receive another agent's reasoning, tool calls, tool results or private notes.

`tool_output` also enforces authorship for exact recovery and search. New results carry their
participant identity before message persistence; older results require an attributed stored message.
Outputs with no provable author are unavailable to participants.

Files in the shared workspace remain visible to every process that can access that workspace. Lane
isolation is context isolation, not a filesystem security boundary.

### Session objective and previous topic summary

Each session stores two shared fields alongside its title: `goal`, the current objective, and
`previousTopicSummary`, the important context carried forward from earlier topics. Both are included
in every participant's system prompt when a run starts, including conversations with one agent. They
belong to the session and remain available when history is checkpointed or the app restarts.

The first user message supplies a fallback objective. When automatic title generation is configured,
the same model call generates the title and objective together. A late response cannot replace a
topic that has already changed.

The conversation leader, or the sole participant, changes the topic through `conversation_control`.
The leader is the current participant with the highest registry leadership priority, with roster
order breaking ties. Other participants do not receive the `topic` field, and the server checks
current leadership again before applying a change. The prompt requires setting a missing goal and
changing topic before starting a new task; follow-ups and remaining steps keep their current topic.

For example:

```json
{
  "next": [],
  "topic": {
    "title": "Parser release",
    "goal": "Deploy the verified parser changes.",
    "previousTopicSummary": "Parser changes are complete and focused tests passed. Keep Bun. Deployment is still pending."
  }
}
```

All three values are required and saved together. The summary carries forward decisions, user
constraints, verified results, useful references and unfinished work, including anything still
relevant in the inherited summary. Titles are limited to 200 UTF-16 code units, goals to 2,000, and
summaries to 8,000; all three values are trimmed and must be non-empty. Changing the topic ends the
current turn; `next` can select the participant who continues. With a topic change, the leader or
sole agent can put its own handle in `next` to continue the new objective in a fresh run with the
updated system prompt. Ordinary handoffs cannot schedule their own author.

The tool call and result remain in the author's private lane. Other participants receive the shared
fields through the session, without access to that lane's reasoning or raw tool output. A topic
change keeps the transcript for you, but starts a new context for every participant. Messages and
tool activity through the changing agent's turn, earlier checkpoints, and earlier runtime context
messages are excluded from subsequent runs. Only the saved summary carries earlier topics into the
system prompt, alongside the new goal. Messages sent after the boundary form the new history.

## Changing participants

The composer can add participants to any existing chat; there is no separate group-creation flow.
For a run that can invite a participant or delegate to an agent, the runtime context includes the
complete scope-aware agent directory as a compact table with IDs, leadership priorities and
`participant` / `available` state. An agent can invite participants through `conversation_control`;
only you can remove them. Adding a second agent changes the strategy of the existing session;
removing agents until one remains restores direct conversation behavior. The session ID, title and
transcript stay the same. The application imposes no numeric group-size ceiling.

Assigning a [Kanban](task-board.md) card to an agent records an owner and nothing else: it does not
add that agent to the conversation, start work or enqueue a turn. To bring the owner in, invite it
with `conversation_control` or the composer; the passive board and the conversation scheduler stay
separate layers.

### Participant usage

An answering participant shows elapsed time. Idle and waiting participants show a usage icon; hover
or focus it to inspect that agent's current context percentage, request limit and accumulated tokens
and cost in this session. Context measurements belong to that author's latest attempt; estimates and
failed attempts are labeled. Clicking opens Usage & Spend. Agents with no recorded usage show an
empty state instead of an invented number.

The usage icon in the conversation header shows total session tokens and cost on hover, including
participants you removed and auxiliary session services. The composer footer has no usage indicator.
Subscription costs remain estimated API-equivalent values rather than billed subscription spend.

The model selector stays inside the composer. In a group it rotates through participant model names
with a provider icon, and opens settings for each participant. Reasoning and turns per message are
saved per agent, provider and model; changing one participant does not change another. Authored
agent and host limits still apply. Permission mode has its own pill above the input.

### Fixing the participants

The lock button next to the add-participant button decides whether the list can change. It is open
by default. Click it to fix the participants and every change stops: the composer shows no add or
remove controls, and the membership writer refuses invitations and user removals. The participants
who are not answering are shown in grey.

You can change the setting only before the conversation starts, which means before the first message
that you or an agent writes. Lines the product writes itself, such as "@qa joined", do not count, so
you can still arrange the participants first. After that an open conversation shows no lock, and a
fixed one keeps a closed lock that can no longer be clicked, and a fork inherits the setting from
its source. The agents are told about it too. A fixed conversation with a single agent still gets
`conversation_control` to change its topic. A fixed group also schedules its participants, while the
tool schema excludes invitations. Participant removal is absent from every agent tool schema.

## Interruptions

A new user message removes pending colleague handoff tickets; tickets still answering your earlier
message remain. Editing a message or regenerating a reply cancels pending agent tickets for the
session because the branch changes. Neither operation clears every queued user message or machine
wake, and tickets already claimed for execution are not removed by this cancellation.

**Stop** aborts the live run and, when a live run is registered, cancels its session's unclaimed
agent tickets. It does not clear queued user messages or machine wakes; pressing Stop while no live
run is registered does not itself cancel pending agent tickets. Use **Clear queue** to remove all
cancellable queued items. Items already claimed for execution remain visible and are reported as
retained. Stop waits up to five seconds for the exact live run to relinquish its slot and reports an
error if it is still shutting down.

An operator Stop also attempts to stop spawned child sessions recursively after the parent settles.
Child-enumeration and individual child-stop failures do not fail the parent's stop, so the parent's
acknowledgement alone does not prove every child ended. Replacing a run with a new message does not
apply this child cascade. To end future [loop](loops.md) runs, cancel the loop separately.

Cards on the chat's board keep their status; an assignment alone did not start work.

## Source of truth

- [Mention grammar](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/agent-mentions.ts)
- [Turn fan-out and history boundary](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/conversation-dispatch.ts)
- [Reference promotion](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/wake-queue/agent-turns.ts)
- [Conversation strategies](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/conversation-strategy.ts)
- [Durable execution queue](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/wake-queue.ts)
- [Queue priority policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/queue-policy.ts)
- [Agent turn tickets](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/agent-turn-ticket.ts)
- [Conversation control](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/tools/conversation-control.ts)
- [Control membership validation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/conversation-membership.ts)
- [Control execution and queue admission](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/conversation-control.ts)
- [Required-call repair](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/run/runtime-execution.ts)
- [Topic input bounds](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/agent-core/session-topic.ts)
- [Stop admission and ticket cancellation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/agent-runner-queue.ts)
- [Stop settlement](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/stop-session.ts)
- [Child-stop cascade](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/stop-cascade.ts)
- [Queue clearing and leased rows](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/wake-queue/steering.ts)
- [Branch-change cancellation](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/branching-ops.ts)
- [Fixed participants](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/roster-lock.ts)
- [Per-agent history projection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/history/stages/participant-view.ts)
