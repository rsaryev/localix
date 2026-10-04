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
| Queued question       | `hitl.required`, key `question:<id>`, severity `info`         | Not `hitl:`, so the boot sweep leaves it; settled when the question closes    |
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

Retry is a `retry_run` command carrying its run on the action (`runId`), so it works the same from a
row the server just recorded and from one found after a reload. Regenerate rewrites the latest
assistant row, a slash command's output included, so Retry names its run as `expectedMessageId` and
the SERVER decides, under the session's mutation lock (`regenerate` in
`apps/api/src/features/chat/service/branching-ops.ts`): a run that is no longer the latest reply is
refused with 409 `regenerate_superseded`, one that never wrote a reply with `regenerate_no_reply`. A
client that read the session first and regenerated second left a window in which a new reply could
land and be rewritten. A refusal becomes an information row and settles the clicked row as
`superseded`; an accepted regenerate settles it as `retried`; a failed one leaves it live. The chat
supplies the regenerate (`retrySessionRun`), so the run paints as started.

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
item's key. Durable kinds (queued questions, plans under review) are rebuilt from their rows at
boot; HITL requests are memory-only and the boot sweep settles their rows.

| Fact                     | Seam                                                                                                                                             | Key                                                                  | Raises nothing when                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Run finished or failed   | `completeRun` / `failRun` after the last retry or segment                                                                                        | `run:<session>:<message>`, failures `run-failed:<session>:<message>` | stopped, a channel turn, a hook verifier, a nested chat's finish, turns still queued |
| Sub-agent or job run     | the same seam, for a `subagent` or `job` session                                                                                                 | `child:<session>:<message>`                                          | a hook verifier                                                                      |
| Question to the person   | `trackRequest` in `hitl-registry.ts`; settled by its ending                                                                                      | `hitl:<request>`                                                     | never; a restart settles every open one (`restart`) before boot continues            |
| Addressed by name        | `publishUserHandoff` in `run/handoff.ts`; settled (`answered`) when the person writes in that conversation (`sendMessage`)                       | `mention:<session>:<message>`                                        | the reply is hidden                                                                  |
| Queued question          | the question registry's `onAsked`; settled by `onResolved` (`answered`, `dismissed` for a skip, `superseded`)                                    | `question:<id>`                                                      | a boot reload — the row already exists                                               |
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

The attention test returns true only for severity `error` or topic `hitl.required` or
`user.mentioned`. The web and desktop app has no toast transport: its interruption is the desktop
native banner, decided in the window (`apps/ui/src/shared/lib/notifications/interruption.ts`) — only
the window knows its focus and which chat is on screen. It asks only for a row that OPENS by a
change delivered live (an `n` frame, or the answer to this window's own op); a catch-up read is
history and never interrupts. The banner kind is `hitl` for the two waiting topics and `run`
otherwise; a fact this window raised states its own wish (`nativeKind`, or none: an outage stays in
the app). A row from the session on screen is marked read. Setting the condition to `always`
bypasses the focus check; it does not make successful completions or ordinary warnings interruptive.

Unknown focus delegates the final decision to the transport. Automatic terminal detection emits OSC
777 only for a TTY with `TERM_PROGRAM=WarpTerminal` and a non-empty `WARP_CLIENT_VERSION`. Other
terminal emulators require an explicit method.

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

### Settle standing conditions

A condition only the client knows is raised with `condition: true` and settled by prefix through
`resolveNotificationCondition` (`store.ts`), a `settle` op with `prefix` and `keep`. The raise and
its settle travel in one ordered op stream, so the newest report is the one kept however fast they
come. A key longer than the server's 400-character cap is shortened deterministically part by part
(`boundedKeyPart` in `inboxMapping.ts`), so the prefix a producer settles by stays the prefix of its
keys.

- **Problem reports** (`problems.ts`): the key is `problemSubjectKey` + a fingerprint of the problem
  set; its parts are URI-encoded so one subject's prefix never covers another's. A new report
  settles the superseded ones, keeping itself. Republishing the report that is already the subject's
  one open row sends nothing — a save loop is not traffic — and only replaces its callbacks.
- **Transport incidents** (`journalIncident.ts`): an outage is one condition keyed by incident kind
  and origin. Recovery settles it and adds no row of its own; the next outage reopens it. A recovery
  with no incident in memory still settles, which is what closes an outage restored from the journal
  after a reload; an owner that goes away (`abandon`) settles its reported outage too.

### Record server conditions

What only the server knows is recorded where it is learned, through
`apps/api/src/features/notifications/conditions/condition.ts`. A row's key is its subject plus a
fingerprint of the problem, so the same problem republished is one row, a changed problem supersedes
the old row, the subject working again settles it as `fixed`, and the problem returning reopens it
with its count advanced. Key parts are URI-encoded and every prefix ends in `:`.

| Subject                            | Raised by                                                                                                                                                              | Settled by                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `plugin:<name>:load:<projectId>:`  | a load that reports an error for the plugin                                                                                                                            | a clean load; the plugin leaving the enabled set                                       |
| `plugin:<name>:backend:`           | the backend host refusing a subsystem                                                                                                                                  | a pass that wires it                                                                   |
| `plugin:<name>:channel:<channel>:` | a channel's receive loop crashing                                                                                                                                      | the channel starting again                                                             |
| `plugin:<name>:monitor:<monitor>:` | a `when: always` monitor's output ending                                                                                                                               | the monitor starting again                                                             |
| `plugins:reconcile:`               | a backend reconcile throwing                                                                                                                                           | the next reconcile that succeeds                                                       |
| `mcp:<server>:<projectId>:`        | a connect failing or asking for sign-in                                                                                                                                | a connect that succeeds                                                                |
| `trigger:<id>:`                    | a loop failing twice in a row                                                                                                                                          | the next fire that succeeds; the loop ending                                           |
| `provider:<connectionId>:`         | an OAuth refresh throwing (not a cancel); a run on the connection ending rate-limited, over its plan limit, or with a refused credential (`AgentErrorInfo.authFailed`) | a refresh that writes a token; a new sign-in; any run on the connection that completes |
| `plugins:load:<projectId>:`        | the whole per-run plugin load of a workspace throwing (`prompt-context.ts`)                                                                                            | the next load that completes                                                           |
| `lsp:<serverId>:<rootDir>:`        | a language server crashing or failing to start                                                                                                                         | the server reporting ready                                                             |

A wake a detached producer could not deliver is an event, not a condition: one error row keyed
`delivery:<deliveryKey>`, and none for a chat that is gone
(`apps/api/src/features/notifications/conditions/triggers.ts`).

### Keep one row per failure

A failed mutation or user-initiated read schedules a generic fallback row (`incidentFallback.ts`,
900 ms grace). A row whose trace carries that failure cancels it — and, since a trace names only the
newest failure of its scope, also every other pending failure of the same session (or of the
application scope) within 10 seconds of it. That is what keeps a batch that reports "Could not
delete 3 entries" from also producing two anonymous rows.

### Trace a failure to its request

A row's trace is never guessed from "the newest failed request of the session": a Kubernetes poll
failing every second would win that race against the Docker request a Docker problem is about, and
the row would show the wrong cause. A problem NAMES its request:

- The host transport marks every response with the trace id it minted (`markResponseTrace`), and a
  plugin's API error reads it back with `problemRequestOf` (both in
  `packages/plugin-sdk/src/ui/transport.ts`) into `Problem.request` — method, path, status, trace id
  and the server's `x-request-id`.
- `publishProblemReport` passes those requests as the fact's `causes`; `recordClientFact`
  (`apps/ui/src/shared/lib/notifications/clientFacts.ts`) traces exactly them through
  `causalTraceSnapshot` (`trace.ts`), marks each as `cause`, and files the row where they happened.
  A cause no longer buffered is rebuilt from the request itself; nothing nearby is substituted. The
  time-window guess remains only for facts that name no request.
- The body ends with one context line per problem: `code · METHOD path → status · request <id>`. A
  code rides in `Problem.code`, never in `field`, which renders as a location.
- `EventTrace.tsx` shows a failed step's status in the line and labels the named cause.
- A request a timer started is not the person's action: the SDK poller runs its tick inside
  `runAsBackgroundWork` (`packages/plugin-sdk/src/ui/visibility.tsx`), and the host credits no click
  to it (`operationContext.ts`). Before, a poll that landed within two seconds of a click raised
  anonymous "Could not load the data" rows.

On the API side every answer carries `x-request-id` (`apps/api/src/lib/request-id.ts`), the access
log line carries the same id, and a rejected JSON answer logs its own `code`, message and `detail`
as `request.rejected` — a plugin route answers its typed body itself, so before this the log had the
status and nothing else. An unrecognized throw logs its stack (`apps/api/src/lib/http.ts`).

### Write an entry

`toast.*` (`apps/ui/src/shared/lib/notify.ts`) keeps a toast's call shape, but every call is a
durable row. The wording is pinned by `apps/ui/src/shared/lib/notifications/wording.test.ts`, which
reads every literal headline in the host, the plugins and the plugin SDK:

- the title is a headline: no trailing full stop, no exclamation mark;
- a failure says what did not happen, actively — "Could not save “a.ts”", never "Failed to…",
  "Couldn't…", "X failed" or "The X could not be Y";
- the reason goes in `description`, from `errorMessage(...)`, never `String(error)`.

A success row is written only for a result the person cannot already see where they acted. A
precondition ("nothing to export") is information, not an error, because an error interrupts. A
toast's `action`/`cancel` callbacks expire after `TOAST_ACTION_LIFETIME_MS` (one minute); a choice
that stays valid for as long as its condition holds belongs in `toast.problems`, whose recovery
actions do not expire.

### Attribute plugin rows

Every plugin UI shares one SDK `toast`, so without attribution a plugin's row read "System". The
host lends plugins a wrapper (`apps/ui/src/shared/contrib/pluginToast.ts`) that attributes each call
from its stack: each loaded plugin UI is imported from its own artifact directory, and
`attributePluginCaller` (`apps/ui/src/shared/contrib/pluginAttribution.ts`) names the plugin whose
directory the innermost matching frame lies under, in V8 and JavaScriptCore stacks alike. A
`runPluginAction` failure publishes on a later microtask, so the SDK lends the call-time stack for
that publish. The wrapper passes the plugin's display name as `source`, which `recordClientFact`
(`clientFacts.ts`) applies as `originLabel`: a label on the derived origin, never a replacement for
it. An unattributable call publishes unchanged; a problem report falls back to its `scope`. A
`source` a plugin supplies itself is dropped.

A plugin's `ctx.reportProblem` is recorded by the server as a standing warning under
`plugin:<name>:problem:<source>:` (`apps/api/src/features/plugins/problem-reporter.ts`), on every
load that runs plugin code — the per-run load, the boot-time backend load and channels. A problem
that names a `sessionId` inside a chat run is also drawn as a transcript line through a
`hook.notice` frame carrying `plugin`
(`apps/api/src/features/chat/runtime/plugin-problem-notice.ts`). Only Settings inspection binds no
reporter, so reading a plugin's roster never files a problem.

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
  terminals remain silent until the user chooses OSC 9, OSC 777, or BEL explicitly.
- The router accepts a quiet flag, but no user-facing schedule or do-not-disturb configuration owns
  it today.
- The web app dedupes by journal key on the server; the terminal transport's router dedupe is
  process-local and has no cross-process record.

## Related guides

- [Manage notifications](../../features/notifications.md)
- [Human in the loop](../../features/hitl.md)
- [Delegation](../../features/delegation.md)

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
