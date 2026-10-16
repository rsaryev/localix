# Notifications subsystem

The notifications subsystem records every fact the Event Center shows in ONE server-side journal,
and lets each window keep a synced copy of it and decide whether to interrupt. Use this page when
adding a producer, a topic, a transport, a retention rule, or a sync boundary.

## The journal

| Part          | Where                                                               | Rule                                                                    |
| ------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Event log     | `notification_events` (append-only, `seq` = sync cursor)            | One row per state change; `seq` is an SQLite rowid and survives restart |
| Projection    | `notification_inbox` (one row per user and subject key)             | Written in the same transaction as the event that changed it            |
| Transitions   | `apps/api/src/features/notifications/projection.ts`                 | Pure; a fact that changes nothing writes nothing, which is idempotency  |
| Write path    | `apps/api/src/features/notifications/journal.ts`                    | `record`/`settle` never await or throw; one in-process writer drains    |
| Client writes | `POST /rpc/notifications/ops`, op ids in `notification_op_receipts` | A resent op (the window's outbox) is a no-op                            |
| Reads         | `GET /rpc/notifications?since=<seq>` and `n` socket frames          | A cursor below the retained `floor` gets the whole inbox                |
| Retention     | `apps/api/src/features/notifications/retention.ts`, daily           | 30 days for rows that need nothing; at most 5 000 rows, settled first   |
| Ownership     | `apps/api/src/features/notifications/ownership.test.ts`             | Only the feature names the tables; a planted direct write must fail     |

A fact's `key` is its identity, derived from what it is about (`hitl:<requestId>`,
`run:<session>:<message>`, `condition:mcp:<server>:…`), never from the moment. Text is scrubbed of
vault values and token patterns before it is stored. A change is published to the user's windows
only after it commits. The window never holds the record: it holds a projection cache, the callbacks
it created (`overlay.ts`), and an outbox for ops the server has not acknowledged.

## Terminology

| Term               | Meaning                                                             | Boundary                                                              |
| ------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Event              | Severity, source, persistence, actions, dedupe key, and lifetime    | It contains no renderer callback, terminal escape, or desktop command |
| Envelope           | One event paired with a unique delivery id and occurrence timestamp | Replay must supply the original fact time for lifetime checks         |
| History            | The server notification journal, one inbox row per fact key         | A window holds a projection cache of it, never the record itself      |
| Interruption       | Toast, native banner, or terminal signal                            | Only errors, human-input requests and mentions; web has no toast      |
| Standing condition | An entry keyed by what is wrong, not by when it happened            | Settled when it stops being true; reopened when it returns            |
| Condition          | `always`, `unfocused`, or `off`                                     | It controls interruption and never removes durable history            |
| Transport          | A host adapter for `history`, `toast`, `native`, or `terminal`      | Unsupported actions degrade to title and body                         |

## Event class → channel (the standard)

Every fact a person is told about belongs to exactly one class, and the class decides where it goes,
how loud it is and how it is worded. A new producer picks its row here before it picks a title.

| Class                                                            | Channel                                                                                | Severity                                             | Persistence    | Wording                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| Person must act now (approval, plan, mention, refused key)       | Attention registry: inline card, dialog, journal row with a live action, banner, dock  | `warning`                                            | Until answered | Imperative; names who asks                                  |
| Person should know later (a run or child ended while away)       | Journal; a banner only for an error while unfocused                                    | `success` / `error` / `info` for a stop              | Durable        | Past tense; a failure is "Could not …" with the reason      |
| System condition (MCP, LSP, plugin, provider, realtime)          | One standing journal row, plus the surface's own problem line and the settings rollup  | `error` = unavailable, `warning` = degraded          | Until fixed    | "Could not connect to …" / "… stopped"; at least one action |
| Feedback to the person's own action (success, no-op, validation) | Transient feedback at the control                                                      | `info` / `success`                                   | Ephemeral      | Short, no full stop                                         |
| The person's own action failed                                   | The control's problem line when it has one, else a journal row — never both            | `error`                                              | Durable        | "Could not <verb> <object>", the reason, an action          |
| Form validation                                                  | Field error with `aria-invalid`                                                        | `error`                                              | View state     | A sentence about the field                                  |
| Background progress                                              | Composer strips, work strip, status bar                                                | Any tone                                             | Live           | Present progressive                                         |
| Conversation fact                                                | Transcript notice (and its model binding)                                              | Any tone                                             | Durable        | A full sentence ending in a full stop                       |
| Agent-facing fact (a refusal, an unanswered card, the breaker)   | The model's text is unchanged; the person reads a separate `personMessage` on the card | A person's decline is `neutral`; policy is `warning` | Durable item   | "You declined bash", "No one answered in 5 minutes"         |

Rules that make the table hold:

- **One tone vocabulary.** `neutral | info | success | warning | error` (`StatusTone` in
  `packages/plugin-sdk/src/ui/status-items.ts`) is what a transcript notice, a status item, a
  diagnostics fact and a settings meta line all say. Stored notices written with the old `muted` are
  rewritten by `apps/api/migrations/20261006T000000_system_notice_tone.ts`.
- **One presentation of a failed run.** `presentErrorInfo`
  (`packages/agent/src/agents/error-presentation.ts`) turns the classification into a headline, a
  reason, a detail and the recovery. The transcript notice
  (`apps/api/src/features/chat/runtime/run/finalize-notices.ts`) and the journal row
  (`apps/api/src/features/notifications/producers/runs.ts`) both render from it, with the same tone.
  A provider's raw body is never the reason; it is only the notice's detail. A run that failed
  before its reply existed still gets its notice, without a Retry.
- **One row per problem.** A failure the connection owns (a refused key, a spent quota) is the
  provider's standing condition and raises no run row of its own.
- **Recovery is typed.**
  `retry | open-settings:<tab>[/<anchor>] | sign-in:<connection> | restart:<subject>`, resolved to
  `localix://` destinations by `apps/api/src/features/notifications/recovery.ts` (exported as
  `@localixai/api/recovery`). A condition cannot be raised without at least one action:
  `ConditionRaise.actions` is a non-empty tuple. A plugin's problem in a transcript is a neutral
  pointer to the same settings row its condition carries, not a second warning.
- **The person's sentence beside the model's.** A gate refusal carries `personMessage`
  (`apps/api/src/features/agent-core/permission-refusal-person.ts`); tool cards render it, and a
  person's own decline renders neutral rather than as an error.

## What you can do

| Operation                     | Mechanism                                                            | Boundary                                                                |
| ----------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Add a lifecycle trigger       | `agentNotificationEnvelope` maps a typed trigger to one domain event | High-frequency stream frames remain outside the notification vocabulary |
| Retain activity across reload | The server journal holds every row; each window syncs a copy of it   | Callback actions stay in the window that made them                      |
| Interrupt on attention events | Shared policy selects toast, native, or terminal channels            | Success and ordinary warnings remain history-only                       |
| Survive reconnect replay      | Stable semantic keys deduplicate repeated lifecycle facts            | Producers must forward the server occurrence time                       |
| Signal a terminal host        | A terminal transport emits OSC 9, OSC 777, or BEL                    | That transport carries no history or toast channel                      |
| Isolate transport failures    | The router records every selected transport result independently     | One failed transport does not cancel its siblings                       |

User-facing controls and Notification Center behavior belong to
[Manage notifications](../../features/notifications.md).

## How it works

### Normalize facts

The event factory assigns a topic, severity, source, declarative actions, dedupe key, dedupe window,
and interruption lifetime. Current trigger coverage is explicit:

| Trigger group         | Topics                                                        | Failure boundary                                                              |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Top-level run         | `run.completed`, `run.failed`                                 | User-stop suppression stays with the producer                                 |
| Human input           | `hitl.required`                                               | The envelope carries open and respond intents                                 |
| Plan to review        | `hitl.required`, key `plan:<root>:<plan>`, severity `warning` | Not `hitl:`, so the boot sweep leaves it; a newer version settles it          |
| Addressed by name     | `user.mentioned`                                              | Keyed to the message, so a replay is one row                                  |
| Child session         | `child.completed`, `child.failed`, `child.stopped`            | Keyed per run; a stop is a quiet `info` row                                   |
| Background terminal   | `terminal.finished`                                           | Exit code zero is success; other exit codes are errors                        |
| Application operation | `application.notification`                                    | The caller supplies severity, title, and optional body                        |
| Standing condition    | `application.notification`, id `application.condition:<key>`  | `applicationConditionEnvelope`; the caller derives the key from what is wrong |

Three producer facts are deliberately not rows. A slash-command reply is wrapped in a
`run.completed` marked `synthetic`; a login shell the person opened exits with `interactive`; and a
`bash notify` job's exit carries `wakesAgent`, because the turn it wakes reports it. A failure in a
sub-agent or job is reported once, by its `child.*` row, even while that session is on screen.

### Retry a failed run

A row whose button no longer acts on anything is settled: `resolvedAt` is set and its actions are
marked unavailable. Lifecycle rows are settled by the server (below); the one client-side settle is
the Retry the person clicked (`apps/ui/src/shared/lib/notifications/runLifecycle.ts`).

Retry carries `runId` in a `retry_run` command, so it works after a reload. The chat supplies
`retrySessionRun` and sends that run as `expectedMessageId` to regenerate. Under the session's
mutation lock (`regenerate` in `apps/api/src/features/chat/service/branching-ops.ts`), the server
refuses a superseded reply with 409 `regenerate_superseded` and a run with no reply with
`regenerate_no_reply`.

A refusal creates an information row and settles the clicked event as `superseded`. An accepted
regenerate settles it as `retried`; a failed request leaves it live. The guard and mutation stay in
one server operation, so a newer reply cannot land between a client check and regeneration.

Stopping a parent stops every child it spawned (`stop-session.ts`). The children whose live run a
cascade took down are marked (`cascadeStoppedSessionIds`), and their run ends record nothing: the
person made one stop, not one per child. A child stopped on its own still records `child.stopped`.

Opening a chat reads its events (`openChatRead.ts`): whenever the chat on screen has unread rows —
on arriving at it, or when its rows land after it opened — they are marked read. Read is not
resolved; a pending request keeps its "Needs action" until it is answered.

### Record agent lifecycle on the server

The server records agent-lifecycle facts into the notification journal where they happen, so a
closed window still learns them (`apps/api/src/features/notifications/producers/`). Each seam holds
an optional reference to one producer; the producers own every rule below. One ordered lane carries
all of them, so a settle recorded right after a raise that needed a session lookup cannot overtake
it.

What waits on the PERSON is not written by a producer of its own. Each such seam is a source of the
attention registry (`apps/api/src/features/attention/sources.ts`), and the registry is the one place
an item is raised and settled. From it follow the user-wide `attention.updated` snapshot frame,
`GET /rpc/attention` (what a reload restores) and, through one observer
(`apps/api/src/features/notifications/producers/attention.ts`), the journal row — whose key is the
item's key. Plans under review, the durable kind, are rebuilt from their rows at boot; HITL requests
are memory-only and the boot sweep settles their rows, along with any `question:` rows left by the
retired queued questions.

| Fact                     | Seam                                                                                                                                             | Key                                                                  | Raises nothing when                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Run finished or failed   | `completeRun` / `failRun` after the last retry or segment                                                                                        | `run:<session>:<message>`, failures `run-failed:<session>:<message>` | stopped, a channel turn, a hook verifier, a nested chat's finish, turns still queued |
| Sub-agent or job run     | the same seam, for a `subagent` or `job` session                                                                                                 | `child:<session>:<message>`                                          | a hook verifier                                                                      |
| Question to the person   | `trackRequest` in `hitl-registry.ts`; settled by its ending                                                                                      | `hitl:<request>`                                                     | never; a restart settles every open one (`restart`) before boot continues            |
| Addressed by name        | `publishUserHandoff` in `run/handoff.ts`; settled (`answered`) when the person writes in that conversation (`sendMessage`)                       | `mention:<session>:<message>`                                        | the reply is hidden                                                                  |
| Plan to review           | the plans service's `present`; settled `answered` (approve, changes sent), `dismissed` (set aside, left Plan mode), `superseded` (newer version) | `plan:<root>:<plan>`                                                 | a review that could not be delivered                                                 |
| Plan completed           | the plans service's `complete` — an `info` `run.completed` row, settles nothing                                                                  | `plan-completed:<root>:<plan>`                                       | never                                                                                |
| Background work ended    | `WorkRegistry.onEnded` (`end`, `hydrate`, `losePending`)                                                                                         | `work:<record>`                                                      | a sub-agent record, or an ending that wakes the agent                                |
| Terminal pane exited     | the terminal service's lifecycle publisher                                                                                                       | `terminal:<terminal>`                                                | a login shell, a waking job, or a pane a work record stands for                      |
| Run cut off by a restart | boot, from the interrupted-run sweep                                                                                                             | `run-failed:<session>:interrupted:<run>`                             | a hook verifier                                                                      |

Every later run of a session settles its open failures (`completed`, or `superseded` for a failed or
stopped run), and an accepted regenerate settles them as `retried`.

A `notify` job killed by a restart records its `work:` row ("was lost when the app restarted") and
ALSO wakes the agent once. That is deliberate: the row names what was lost; the woken turn is the
agent's own reply to it, reported like any run.

### Select channels

`notificationChannels` first retains durable history when a history transport exists. It then
applies the interruption lifetime, quiet flag, attention test, condition, and focus state in that
order. An expired, quiet, disabled, or focused event can therefore enter history without producing a
toast, native banner, or terminal escape.

The attention test returns true for severity `error` or category `human-input`. The category covers
blocking requests, mentions, and plans waiting for review. The web and desktop app has no toast
transport: its interruption is the desktop native banner, decided in the window
(`apps/ui/src/shared/lib/notifications/interruption.ts`) — only the window knows its focus and which
chat is on screen. It asks only for a row that OPENS by a change delivered live (an `n` frame, or
the answer to this window's own op); a catch-up read is history and never interrupts.

The banner kind is `hitl` for the `human-input` category and `run` otherwise; a fact this window
raised states its own wish (`nativeKind`, or none: an outage stays in the app). A row from the
session on screen is marked read. Setting the condition to `always` bypasses the focus check; it
does not make successful completions or ordinary warnings interruptive.

Unknown focus delegates the final decision to the transport. The current web/desktop composition
selects only the native channel and does not connect a terminal transport, even though preferences
store a terminal method. For a host that connects the shared terminal adapter, automatic detection
selects OSC 777 only for a TTY with `TERM_PROGRAM=WarpTerminal` and a non-empty
`WARP_CLIENT_VERSION`. Other terminal emulators require an explicit method.

### Keep a window's copy of the journal

The Event Center renders a projection cache of the server inbox
(`apps/ui/src/shared/lib/notifications/journal.ts`), in three layers:

| Layer   | Holds                                                                 | Owner        |
| ------- | --------------------------------------------------------------------- | ------------ |
| rows    | what the server confirmed, each key at the highest `seq` seen for it  | `journal.ts` |
| pending | ops this window made and the server has not answered, replayed on top | `outbox.ts`  |
| overlay | process-local callbacks ("Undo", "Open board.json:7"), merged in last | `overlay.ts` |

**Sync** (`inboxSync.ts`, `journalDelivery.ts`). The server keeps no replay ring for the `n` frame,
so on every socket connect the window reads `GET /rpc/notifications?since=<cursor>`; the frame
subscription already exists by then, so a change committed between the two arrives both ways and the
per-key `seq` rule applies it once. A `full` answer (a first read, or a cursor below the retained
`floor`) replaces the copy, keeping any row that arrived live after the snapshot. A server whose
cursor is behind the window's (a reset `~/.localix`) is read again from zero. A live frame advances
the cursor only after its connection's catch-up read has landed.

**Ops** (`store.ts`). Every mutator — raise, settle, read, read-through, remove, clear — is applied
at once through the optimistic transitions in `core.ts` and sent as a `ClientJournalOp`. The same
transitions answer what an arriving raise does to the rows on screen:

| Arriving raise                                                   | Result                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Same key as an unsettled row (replay, republished condition)     | The existing row is kept unchanged, read state included       |
| Same key as a SETTLED standing condition                         | The row reopens on top, unread, with its occurrence count + 1 |
| Same key as a settled lifecycle row (an answered request)        | Kept settled; a replay never reopens it                       |
| An anonymous application event identical to one within 5 minutes | Coalesced into that row with an occurrence count              |

The server's projection makes the authoritative call and its answer replaces the optimistic row in
the same step the op leaves the outbox.

**Outbox** (`outbox.ts`). An op the server has not answered stays in a `localStorage` delivery
buffer (capped at 1,000) and is resent on the next connect or after a backoff, with its original
`occurredAt` and `id`, so a resend after a lost answer is a no-op. A batch the server rejects as
malformed is dropped. The journal's own requests are excluded from HTTP tracing
(`httpInstrumentation.ts`): reported, each failed POST during an outage would raise another fact.

The rendered list is newest-first and capped at 200 rows by `trimToCap`, which drops the oldest
SETTLED rows first: a pending request or a standing condition outlives newer noise. Opening the
Event Center does not mark anything read; expanding a row, running its action or opening its source
does.

Operation receipts are retained for seven days, independently of thirty-day journal retention. After
pruning a receipt, the same client operation ID can be accepted again; exactly-once replay is not a
permanent guarantee. Failed delivery retries at 2–60 seconds while connected. Invalid batches are
removed from the outbox rather than retried. Catch-up reconstructs current inbox rows and removals,
not each intermediate event state.

### Conditions and request failures

[Notification problem contracts](notification-problems.md) define condition keys, recovery, request
attribution, duplicate suppression, wording, and plugin labels. A problem's journal row must
identify the failure it reports and settle when its owning condition clears.

## Configuration

### Shared policy

| Control                | Values                          | Default     | Boundary                                     |
| ---------------------- | ------------------------------- | ----------- | -------------------------------------------- |
| Notification condition | `always`, `unfocused`, `off`    | `unfocused` | Controls interruption only                   |
| Terminal method        | `auto`, `osc9`, `osc777`, `bel` | `auto`      | `auto` recognizes the Warp TTY contract only |
| Event Center cap       | 200 entries                     | 200         | Oldest settled entries are removed first     |

### Trigger windows

| Trigger                  |                           Interruption lifetime | Dedupe window |
| ------------------------ | ----------------------------------------------: | ------------: |
| Top-level run            |                                      10 minutes |    30 seconds |
| Human input              | 60 minutes, capped at the request's `expiresAt` |    30 seconds |
| Child session            |                                      10 minutes |    10 minutes |
| Addressed by name        |                                      60 minutes |    30 seconds |
| Background terminal      |                                      10 minutes |    10 minutes |
| Application notification |                                      10 minutes |    30 seconds |
| Standing condition       |                                      60 minutes |    60 minutes |

### Preference storage

The web preference store also keeps `appIconBadge`, defaulting to `true`. That shell-specific field
is outside the shared `NotificationPreferences` contract.

## Limits

- A window's callback actions live only in that window's memory: another window, and the same window
  after a reload, shows the row without them. Retry survives as the `retry_run` command; Respond is
  a navigation to the session.
- A delivery hint (`nativeKind`) is known only to the window that raised the fact; another window
  decides its banner from the row's topic and severity alone.
- Interruption needs a first catch-up read: a frame arriving before it is recorded without a banner,
  because nothing can tell a new row from one this window has not seen yet.
- Desktop native delivery sends title and body only. Navigation, Retry, and Respond remain in the
  Event Center.
- Plugin attribution reads the call stack. A publish that runs after an `await` outside
  `runPluginAction`, or from a React effect in the shared `useProblemReport` hook, has no plugin
  frame on the stack; problem reports then fall back to their `scope`, toasts to no label.
- Native banners still depend on shell support and operating-system permission. The shared router
  cannot prove that the operating system displayed a selected notification.
- Automatic terminal capability detection recognizes one exported terminal contract. Generic
  terminals need an explicit OSC 9, OSC 777 or BEL method and a host that connects the adapter.
- The router accepts a quiet flag, but no user-facing schedule or do-not-disturb configuration owns
  it today.
- The web app dedupes by journal key on the server; the terminal transport's router dedupe is
  process-local and has no cross-process record.

## Related guides

- [Notification problem contracts](notification-problems.md)
- [Manage notifications](../../features/notifications.md)
- [Human in the loop](../../features/hitl.md)
- [Forks](../../features/delegation.md)

## Source of truth

- [Domain types and defaults](../../../packages/notifications/src/contracts.ts)
- [Trigger normalization](../../../packages/notifications/src/events.ts)
- [Channel selection](../../../packages/notifications/src/policy.ts)
- [Dedupe and delivery](../../../packages/notifications/src/router.ts)
- [Terminal capability and encoding](../../../packages/notifications/src/terminal.ts)
- [Notification commands](../../../apps/ui/src/shared/lib/notifications/runtime.ts)
- [Web preferences](../../../apps/ui/src/shared/lib/notifications/prefs.ts)
- [Optimistic transitions](../../../apps/ui/src/shared/lib/notifications/core.ts)
- [Window copy of the journal](../../../apps/ui/src/shared/lib/notifications/journal.ts)
- [Sync and op delivery](../../../apps/ui/src/shared/lib/notifications/journalDelivery.ts)
- [Op outbox](../../../apps/ui/src/shared/lib/notifications/outbox.ts)
- [Callback overlay](../../../apps/ui/src/shared/lib/notifications/overlay.ts)
- [Client facts](../../../apps/ui/src/shared/lib/notifications/clientFacts.ts)
- [Live interruption](../../../apps/ui/src/shared/lib/notifications/interruption.ts)
- [Transport incidents](../../../apps/ui/src/shared/lib/notifications/journalIncident.ts)
- [Server conditions](../../../apps/api/src/features/notifications/conditions/condition.ts)
- [Plugin conditions](../../../apps/api/src/features/notifications/conditions/plugins.ts)
- [Headline wording guard](../../../apps/ui/src/shared/lib/notifications/wording.test.ts)
- [Server agent-lifecycle producers](../../../apps/api/src/features/notifications/producers/index.ts)
