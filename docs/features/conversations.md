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

Role matching is an agent instruction; the scheduler does not inspect a message's subject to choose
a specialist automatically.

## Passing work between agents

Everyone in the conversation reads every reply: you and each participant. Nobody sees another
participant's reasoning or tool calls, so an agent writes its reply once, for all readers. The reply
is also how it hands the floor on: each participant it addresses with `@handle` answers once, in the
order addressed, and reads that reply as its assignment.

```text
@design, draft the checkout mockup at 390 px; @frontend, build it after I approve.
```

- A handle inside code, a fenced block, a block quote or a link target is a reference, not an
  address. An agent refers to a colleague by name without `@` when it does not need them to act.
- An agent never addresses itself, and addressing an agent who is already queued folds into that
  turn instead of queuing a second one.
- A reply that addresses nobody returns the floor. After an assignment it goes back to the colleague
  who asked, as a report, so finished work always reaches the one who gave it. After a report, or on
  a turn you started, it ends with you. `@user` hands the floor to you explicitly.
- Addressing the colleague who assigned the current turn is a report too, so two agents do not keep
  passing the floor back and forth.
- A participant that is named but asked nothing, or whose part is already reported, passes with
  `skip_answer`: its turn ends at once without a message, and nothing is routed back, so a colleague
  named in passing does not restart the exchange.
- Every hop between agents counts toward the handoff limit; past it, the conversation returns to you
  with a notice.

Every turn is expected to end with a message: a result with its evidence, the decision the agent
needs, or the blocker. A turn that does work without writing anything reaches its colleagues as one
line saying it ended without a message, and an assignment still reports back to whoever gave it.
Successful topic changes are hidden in the transcript; they do not hide other actions in the same
message. Only turns with no text, plan or other visible tool activity are hidden as silent.

Tagging an available agent who is not in the conversation yet invites it, from your message or from
any participant's reply, and the tag then gives it the floor.
[Fixed participants](#fixing-the-participants) prevent invitations. Agents cannot remove
participants; use the composer to remove someone yourself. The current registry rides each turn's
context as the agent directory, so agents do not need a tool call to find one another.

Creating or assigning tasks and inviting participants are not execution. When you ask for work, the
agent is instructed to act, address the colleague who owns the next part with the context they need,
or explain a concrete blocker. When nobody is addressed and nothing is queued or running, the
conversation is idle; no timer automatically starts the backlog.

A solo agent in an open chat is told only that tagging a directory agent brings it in. The full turn
protocol applies from the first turn that starts with two or more agents. The protocol sits in the
cached part of the system prompt and the participant roster in the per-turn tail, so an invitation
does not rewrite the cached prefix. When to do the work yourself, fork or bring a colleague in is
one `# Collaboration` rule.

For dependent work, the leader records the dependency and addresses only the next participant whose
part is actionable. Results move through the chain one owner at a time; status broadcasts to the
whole roster create redundant turns and are discouraged.

The `# Collaboration` rule follows the conversation. Alone, an agent does the work itself and brings
a suitable colleague in when another role is needed. An agent can also [fork itself](delegation.md)
for independent side work; that is on by default. Agents do not delegate work to other agents:
another role joins the conversation as a participant.

Once colleagues are present, every participant — not only the leader — does its own part and
addresses a colleague's ready part to them, so the work happens where you can see and redirect it.

The leader coordinates and does not do a colleague's part. Work that depends on a decision you have
not made yet, such as approving a mockup, waits for it. A report the user already read is not
restated: the leader adds only the decision or what is missing.

Your change requests and any checks a report left unverified go back to the owner or QA. When you
ask for the team in a one-agent conversation, the agent routes the parts to roles instead of
finishing the work alone. For a new screen, flow or visible redesign the designer's first
deliverable is a rendered mockup opened in the visible preview, and implementation starts after you
approve it; a small change to an existing screen goes straight to the engineer.

A turn needs no closing call, so a reply without tool work costs one model request. Earlier versions
ended every group turn with a terminal `conversation_control` call that duplicated the reply as a
hidden note and usually took a second request; older transcripts still show those notes to agents.

Membership, topic changes, and queue admission are separate writes. Routing happens after the reply
is saved, so a queue failure never loses the reply; it is logged, and earlier recipients may already
have been queued. A reply that addresses nobody adds no turns and does not cancel work already
waiting.

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
`fork` message can also amend its running fork's task at a step boundary.

Your steering message outranks the tool calls the agent chose before it could read the message. A
call that is already running finishes, but the calls of the same response that have not started yet
are returned unrun, with a note to re-issue them if they still apply. Your message then reaches the
model at once instead of after the whole batch. Calls waiting on an approval prompt are not
deferred, because your message may be the answer to it.

An eligible child report can join the forking agent's next model request after a fully completed
tool turn, at most one report per tool boundary. Group chats require the report to address the
current speaker; a solo chat can also take an unaddressed report. Other reports, webhooks and loops
wait for a separate turn. The host waits for tool-checkpoint settlement before splitting the
assistant row; see [Forks](delegation.md#progress-and-report-delivery). Disabling
`LOCALIX_MID_RUN_INTERJECT` keeps these queued messages and reports for later turns.

A slash command sent while the session is busy waits in the queue as a whole command — with its
badge, model and tool grants — and runs as its own turn.

## What each agent sees

Every agent reads your messages and its colleagues' replies, with immutable author attribution. Each
agent also receives its own reasoning, tool activity, addressed runtime events and its own
checkpointed view. It does not receive another agent's reasoning, tool calls or tool results: an
action belongs to its actor, and reading a colleague's edits as context made agents describe them as
their own.

A colleague's turn that failed or was stopped appears as one line saying so, not as the error text,
and a turn that did work without writing anything appears as one line saying it ended without a
message. On rows written before replies were shared, a silent turn still reaches colleagues as the
hidden note it carried.

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

The conversation leader, or the sole participant, changes the topic with `set_topic`. The leader is
the current participant with the highest registry leadership priority, with roster order breaking
ties. Other participants do not receive the tool, and the server checks current leadership again
before applying a change. The prompt requires setting a missing goal and changing topic before
starting a new task; follow-ups and remaining steps keep their current topic.

For example:

```json
{
  "title": "Parser release",
  "goal": "Deploy the verified parser changes.",
  "previous_topic_summary": "Parser changes are complete and focused tests passed. Keep Bun. Deployment is still pending."
}
```

All three values are required and saved together, once per turn. The summary carries forward
decisions, user constraints, verified results, useful references and unfinished work, including
anything still relevant in the inherited summary. Titles are limited to 200 UTF-16 code units, goals
to 2,000, and summaries to 8,000; all three values are trimmed and must be non-empty.

Changing the topic does not end the turn: the agent continues the new work in the same run. The
history boundary sits just before your message that opened the new topic, so that request and the
work done on it stay in every later run's context, while everything before it is replaced by the
saved summary, along with earlier checkpoints and runtime context messages. A topic change keeps the
transcript for you. Earlier versions ended the turn and queued the leader again, which could loop:
the fresh run no longer saw the request and set the topic once more.

The tool call and result remain in the author's private lane. Other participants receive the shared
fields through the session, without access to that lane's reasoning or raw tool output.

## Changing participants

The composer can add participants to any existing chat; there is no separate group-creation flow. In
an open chat, the runtime context includes the scope-aware agent directory: one line per agent with
its handle, leadership priority, `participant` / `available` / `unavailable` state and description.
Tagging an available agent invites it; only you can remove participants. Adding a second agent
changes the strategy of the existing session; removing agents until one remains restores direct
conversation behavior. The session ID, title and transcript stay the same. The application imposes
no numeric group-size ceiling.

Assigning a [Kanban](task-board.md) card to an agent records an owner and nothing else: it does not
add that agent to the conversation, start work or enqueue a turn. To bring the owner in, tag it in a
message or add it with the composer; the passive board and the conversation scheduler stay separate
layers.

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
its source. The agents are told about it too. A fixed conversation with a single agent can still
change its topic with `set_topic`. In a fixed group, addresses still hand the floor between the
participants, but a tag never invites anyone. No agent can remove a participant.

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
