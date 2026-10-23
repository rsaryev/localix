# Notification problem contracts

Standing conditions keep one journal row for a problem until its owner reports recovery. Use this
guide to connect a producer's failures to their requests, deduplicate reports, and preserve plugin
attribution. [Notification delivery](notifications.md) owns the journal and channel policy.

## How it works

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
  `packages/mini-app-sdk/src/ui/transport.ts`) into `Problem.request` — method, path, status, trace
  id and the server's `x-request-id`.
- `publishProblemReport` passes those requests as the fact's `causes`; `recordClientFact`
  (`apps/ui/src/shared/lib/notifications/clientFacts.ts`) traces exactly them through
  `causalTraceSnapshot` (`trace.ts`), marks each as `cause`, and files the row where they happened.
  A cause no longer buffered is rebuilt from the request itself; nothing nearby is substituted. The
  time-window guess remains only for facts that name no request.
- The body ends with one context line per problem: `code · METHOD path → status · request <id>`. A
  code rides in `Problem.code`, never in `field`, which renders as a location.
- `EventTrace.tsx` shows a failed step's status in the line and labels the named cause.
- A request a timer started is not the person's action: the SDK poller runs its tick inside
  `runAsBackgroundWork` (`packages/mini-app-sdk/src/ui/visibility.tsx`), and the host credits no
  click to it (`operationContext.ts`). Before, a poll that landed within two seconds of a click
  raised anonymous "Could not load the data" rows.

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

The host wraps the shared SDK `toast` with `apps/ui/src/shared/contrib/miniAppToast.ts`.
`attributeMiniAppCaller` (`apps/ui/src/shared/contrib/miniAppAttribution.ts`) finds the innermost
loaded plugin artifact in V8 or JavaScriptCore call stacks. For a deferred `runMiniAppAction`
failure, the SDK supplies its call-time stack.

The wrapper supplies the plugin display name as `source`. `recordClientFact` (`clientFacts.ts`) uses
that label as `originLabel` without replacing the derived origin. Unattributable calls publish
unchanged; problem reports fall back to their `scope`. The host drops any `source` supplied by the
plugin itself.

A plugin's `ctx.reportProblem` is recorded by the server as a standing warning under
`plugin:<name>:problem:<source>:` (`apps/api/src/features/plugins/problem-reporter.ts`), on every
load that runs plugin code — the per-run load, the boot-time backend load and channels. A problem
that names a `sessionId` inside a chat run is also drawn as a transcript line through a
`hook.notice` frame carrying `plugin`
(`apps/api/src/features/chat/runtime/plugin-problem-notice.ts`). Only Settings inspection binds no
reporter, so reading a plugin's roster never files a problem.

## Limits

- Stack attribution requires a plugin frame or the call-time stack supplied by `runMiniAppAction`.
  Asynchronous effects without that context fall back to the report scope or an unlabeled toast.
- Transient toast callbacks expire after one minute and stay in the originating window. Durable
  recovery belongs in a problem report, navigation action, or typed command.
- A request trace identifies its cause; a nearby failed poll must not replace that cause.

## Related guides

- [Notification journal and delivery](notifications.md)
- [Plugin failure reporting](../../extending/plugin-problems.md)
- [User notification controls](../../features/notifications.md)

## Source of truth

- [Server condition transitions](../../../apps/api/src/features/notifications/conditions/condition.ts)
- [Plugin condition producers](../../../apps/api/src/features/notifications/conditions/plugins.ts)
- [Client standing conditions](../../../apps/ui/src/shared/lib/notifications/store.ts)
- [Incident fallback and duplicate suppression](../../../apps/ui/src/shared/lib/notifications/incidentFallback.ts)
- [Client causal tracing](../../../apps/ui/src/shared/lib/notifications/clientFacts.ts)
- [Plugin notification wrapper](../../../apps/ui/src/shared/contrib/miniAppToast.ts)
- [Plugin stack attribution](../../../apps/ui/src/shared/contrib/miniAppAttribution.ts)
- [Server plugin problem reporter](../../../apps/api/src/features/plugins/problem-reporter.ts)
- [SDK request attribution](../../../packages/mini-app-sdk/src/ui/transport.ts)
- [Headline wording guard](../../../apps/ui/src/shared/lib/notifications/wording.test.ts)
