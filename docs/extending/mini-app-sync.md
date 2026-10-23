# Mini app synchronization

Mini apps use the installation's existing multiplexed `/rpc/ws` socket. A change notification names
an owned resource and scope; the resource's HTTP read supplies the authoritative value. Repeated
notifications are harmless. Navigation, selections and unsaved drafts remain local to each window.

## Choose the source

| Resource                                  | SDK entry point                                                            | Healthy behavior                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Project files, including agent file edits | `ui/file-resource-sync`: `useFileResourceSync`                             | Read on matching file notifications; no periodic polling.                 |
| Session or user JSON stores               | `backend`: `createStoreChangeFeed`; `ui/store-resource`: `useStoreChanges` | Commit and native file notifications share one scoped feed.               |
| A board whose routes return snapshots     | `ui/store-snapshot`: `useStoreSnapshot`                                    | Validated reads on notifications; mutation answers supersede older reads. |
| Service-owned state                       | `backend`: `observeMutations` and an owned `wsFrames` contribution         | Explicit successful mutation maps; read methods stay silent.              |
| High-frequency external data              | `ui/realtime-feed`: `createRealtimeFeed`, `useRealtimeFeed`                | Scoped typed deltas; source-specific recovery.                            |

For a project file read model:

```ts
const sync = useFileResourceSync({
  sessionId,
  prefix: '.localix/my-app',
  enabled: visible,
  read: (signal) => api.list(sessionId, signal),
  apply: (snapshot) => setSaved(snapshot),
  onError: (error) => setReadError(error),
})
```

Pass cancellation through the client to the request. `refresh()` waits for registered reads to
settle, including a follow-up owed after an overlapping invalidation. It returns `Promise<void>`
rather than a snapshot or success verdict; disconnect, teardown, and exhausted retries also release
waiters. Keep failure state in `onError` and treat only `apply` as a new accepted snapshot.
`supersede()` expires an older read when a direct mutation answer already supplies the newer value.
Keep optimistic/draft state out of an unconditional `apply`: merge independent changes or surface a
conflict.

`read` must settle and honor its abort signal; the scheduler supplies no request deadline of its
own. Give network reads an appropriate timeout as well as cancellation. For a failing read,
`onError` runs after retries are exhausted, rather than on every attempt. Deactivating or disposing
the reader releases refresh waiters even if a read ignores cancellation; that read's result cannot
be applied, but its underlying work can continue.

## Route snapshot options

`useStoreSnapshot` keeps a schema-validated last-good snapshot. Its `intervalMs` is the fallback
cadence while the store feed is not live; `backstopMs` is the cadence with live coverage and
defaults to `null`. Setting `intervalMs: null` disables the disconnected fallback too. Choose a
non-null fallback when external edits must remain visible without native coverage.

This hook's `refresh()` returns `void`: it starts a read, unlike the awaitable file-resource refresh
above. Observe `snapshot` and `error` for its result. `send(body, options)` sends a mutation and
validates its returned snapshot with the same schema; it resolves to that response or `null` on
failure. Scope and request ordering determine whether the response is applied to the visible state.
A failed read retains the previous valid snapshot.

Reads and sends use an eight-second abort timeout by default, configurable with `timeoutMs`. A
timeout or invalid mutation response does not roll back a server write that already committed.
Reconcile before retrying a mutation whose outcome is unknown, using the owning domain's revision or
idempotency contract.

## Publish after commit

A JSON-store backend registers `createStoreChangeFeed` with its mini app name, an ownership-checking
`resolveDir(userId, sessionId)`, a committed-write subscription, and `ctx.watchPath` when available.
Register its `wsFrames` and release it through `onShutdown`. Never accept an absolute subscription
path or trust a user ID from the command payload. `acceptPath` can narrow a directory to the owning
user's file; coarse filesystem events invalidate conservatively.

The shared protocol uses commands `<app>:store.subscribe` and `<app>:store.unsubscribe`, frame tag
`c`, and `{ plugin, sessionId }` invalidations. A status frame additionally supplies `live`.
`sessionId: null` names installation-owned mini app state, not an arbitrary user's state. The
socket's host-supplied user ID still governs resolution and reads. The local API uses self-asserted
identity; this scope contract does not authenticate a network caller. Frames never contain
credentials or documents.

`live: true` means the native source is covered, not merely that the host accepted a command.
Without a native watcher, committed API changes still arrive promptly but the reader keeps its
fallback for external file edits. Watcher failure and socket disconnect set liveness false.

Service-backed state uses an explicit mutation map with `observeMutations`. HTTP, agent tools and
internal callers must share that service instance or a shared publisher. Do not infer mutations from
HTTP verbs: a POST may generate a preview or perform a read. Notification failure cannot turn a
successful committed write into a failed mutation.

## Two change feeds

The store change feed and `host.changes` do different jobs, so a mini app may use both:

| Question          | Store change feed (`createStoreChangeFeed`)        | `host.changes`                                      |
| ----------------- | -------------------------------------------------- | --------------------------------------------------- |
| Who listens       | Open views over `/rpc/ws`                          | Backend consumers in the mini app                   |
| What it covers    | Committed writes and external file edits (watcher) | Notices the mini app records; the core's deletions  |
| Missed while away | Nothing kept: the view reads again on reconnect    | Kept in SQLite; a consumer catches up at its cursor |
| Cost per write    | An in-memory nudge, coalesced per 50 ms            | One database row                                    |

A view needs the newest state, not a history: a reconnect read already covers what it missed, and a
file edited outside the app has no transaction to record. Recording every store write durably would
add a database row per write and still not cover an edit made while the watcher was down. A backend
consumer that builds derived data (an index, a digest, a cleanup) needs the opposite: every notice,
across restarts. Keep store refreshes on the store feed and durable processing on `host.changes`.

## Read and recover

`createResourceSync` from `ui/resource-sync` is shared with core. It coalesces invalidations,
serializes each registered reader, rejects superseded answers, aborts cancellable reads on teardown,
and retries failures with bounded delays (1, 2, and 4 seconds by default, then waits for a new
invalidation or refresh). New invalidation bypasses a pending retry delay. Shared resources use this
scheduler too, including invalidations during their first load and cache reset while a request is
pending.

Subscribe and then reconcile to close the initial-read gap. Reconcile again after reconnect and
returning to visibility. Follow the owning work item's visibility; hidden store feeds unsubscribe
and resume with a fresh read. Do not create a steady timer when all change sources are covered. Use
`intervalMs: null` for event-driven snapshots. `useVisiblePolling` still supports an optional focus
read without a timer.

A server cache must expire before the subsequent read: use `UserEntityStore.invalidate(userId)` or
an equivalent domain-owned policy. Otherwise the socket can work perfectly while HTTP keeps
returning the cached old value. Native watchers complement successful mutation notifications; they
do not replace revision checks, write serialization or draft conflict handling.

Retain polling only for a concrete coverage gap: unsupported watchers, a lost connection, metrics
without an event API, or a Git directory outside the watched project. Local clocks and batched
analytics writes are not state polling. Event delivery is not distributed exactly-once execution;
reconnect reads and existing revision/idempotency guards remain necessary.

## Validate a mini app

Exercise initial subscription, edits from another window, agent/API writes, atomic file replacement,
bursts during an in-flight read, reconnect, scope changes, watcher failure and unmount. Assert that
an older answer cannot undo a newer mutation, a dirty draft survives, and a healthy idle resource
makes no periodic requests. Test user isolation and release both write and filesystem listeners.

## Related guides

- [Workbench UI](mini-app-ui.md)
- [Permission rules](../features/permissions.md)

## Source of truth

- [Resource scheduler](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui/resource-sync.ts)
- [Project-file synchronization](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui/file-resource-sync.ts)
- [Store change publisher](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/store-change-feed.ts)
- [Store snapshot reader](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui/store-snapshot.ts)
- [Route snapshot validation and ordering](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/ui/route-snapshot.ts)
- [Explicit mutation notifications](https://github.com/rsaryev/localix/blob/main/packages/mini-app-sdk/src/backend/observe-mutations.ts)
