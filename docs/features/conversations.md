# Conversations with several agents

A conversation is one session with one shared public transcript. Its behavior follows its active
participants: one agent uses direct conversation behavior, while two or more agents use the
multi-participant strategy. Adding or removing an agent does not create another session or rewrite
its history.

![Team Lead, Frontend and QA sharing a release review in one conversation](../assets/screenshots/conversations/participants--2026-10-15.png)

_Demo workspace captured on 15 October 2026 with a seeded conversation. It shows the participant
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
  a turn you started, it ends with you.
- `@human` addresses you, in a solo chat or a group. It ends the chain: no colleague named in the
  same reply is queued, the chat waits for you, and you get a mention notification. At most one
  mention waits per chat until you write there. Agents use the `ask` tool instead for a choice
  between options. See [Human](agents.md#human).
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
any participant's reply, and the tag then gives it the floor. Agents cannot remove participants; use
the composer to remove someone yourself. The current registry rides each turn's context as the agent
directory, so agents do not need a tool call to find one another.

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

An answering participant shows elapsed time. Participant chips carry no usage controls of their own:
the usage icon in the conversation header shows total session tokens and cost on hover, including
participants you removed and auxiliary session services. In a group the same card lists each
participant with their latest context percentage and accumulated cost; context measurements belong
to that author's latest attempt. Clicking the icon opens Usage & Spend. The composer footer has no
usage indicator. Subscription costs remain estimated API-equivalent values rather than billed
subscription spend.

The model selector sits in the composer's action row and shows only the model name. In a group,
clicking a participant chip selects that participant without inserting a mention: the selector, the
context gauge and the model picker's starting row follow the selected participant, and picking
another participant inside the picker selects it in the composer too. The first participant is
selected by default. Reasoning and turns per message are saved per agent, provider and model;
changing one participant does not change another. Authored agent and host limits still apply.
Permission mode has its own pill above the input.

### Models for agents before they join

The Agents list in the model picker shows the conversation's participants first, then every other
agent that could join it, each marked _not invited_. Pick a model for an agent before you invite it:
the choice belongs to this conversation, and the agent joins on that model and level. Without a
choice here, the row shows what the agent would join on: its default model, else the model you last
picked for it, else the project's (see
[Which model a participant runs on](providers.md#which-model-a-participant-runs-on)). A model chosen
for one agent never changes another agent's model.

### One model for every agent

Each agent keeps its own model and reasoning level, so switching one agent to a stronger model
leaves the others where they were. The Agents list always starts with an **All agents** row, also in
a conversation with one agent. Its second line states the current mix, for example
`Mixed · 2 models · 2 levels · 1 not set`. Screen readers announce the same text with the row.

Select **All agents**, then pick a model as usual. Every listed agent, invited or not, moves to that
model in a single write: **All agents** is a shortcut that makes the same choice for each listed
agent, not a separate setting. Each of those choices also becomes your last choice for that agent,
so a new conversation starts every agent without a default model on it. An agent that can no longer
take part causes the whole change to be refused instead of half-applied.

The level starts at the model's default, or at a level you set for that model in its details first,
and is clamped to the levels the model offers. Once every agent shares a model, changing the
reasoning level in the model's details changes it for everyone. The choice is remembered per agent
and model, as a single pick is. Turns per message remain a per-agent setting.

A check mark on **All agents** shows that every listed agent is on the same model and level. Picking
a model for one agent afterwards moves only that agent; the others keep their model, and the check
mark disappears.

Reasoning **Off** is offered only for models that can actually turn reasoning off; elsewhere the
request carries the model's lowest level, and the picker shows that level instead of Off. A model
that does not reason stores Off. The server applies the same rule to every route change, so a level
a model does not offer is stored as the nearest level it does offer. The agent editor's **Effort**
field offers the same levels for the agent's pinned model.

### Switch models with `/model`

Type `/model` to choose a model without opening the picker. The composer shows the picker's columns
as steps, in the same order, each with a list of choices:

1. **Agent** — **All agents** comes first, followed by each participant with its current model and
   level, then the agents that are not invited yet. A conversation with one agent shows this step
   too.
2. **Provider** — your connections, in the picker's order. The participant's current connection is
   marked.
3. **Model** — the models of that connection. Type to filter by name, id or reasoning level.
4. **Settings** — optional. **Reasoning** offers only the levels the chosen model supports and is
   skipped for a model that does not reason. For one participant, **Turns per message** and
   **Context limit** follow; each offers _Keep_, _Use default_ and the picker's values. Context
   limit is skipped for a model with nothing to choose, and accepts `auto`, `400k`, `1m` or `full`.
   **All agents** stops after Reasoning, as the picker does.

Each choice becomes a crumb in the composer. Select a crumb's × to return to that step, or press
Backspace in an empty step to remove the last crumb. Press Enter on an optional step to apply what
you have chosen. The result is the same write the picker makes: one participant's route, or one
batch for **All agents**, with the level starting where the picker would start it. `/model` and the
picker store the choice the same way, so an agent's next run and an agent that joins later both use
it.

`/model` never prints a list of models. `/model <name>` still switches the participant you are
addressing (or `/model @qa <name>`) by matching the name.

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
- [Per-agent history projection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/history/stages/participant-view.ts)
