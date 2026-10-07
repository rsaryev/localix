# Plugin synchronization

Plugins use the installation's existing multiplexed `/rpc/ws` socket. A change notification names an
owned resource and scope; the resource's HTTP read supplies the authoritative value. Repeated
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
  prefix: '.localix/my-plugin',
  enabled: visible,
  read: (signal) => api.list(sessionId, signal),
  apply: (snapshot) => setSaved(snapshot),
  onError: (error) => setReadError(error),
})
```

Pass cancellation through the client to the request. `refresh()` waits for the current authoritative
read, including a follow-up owed after an overlapping invalidation. `supersede()` expires an older
read when a direct mutation answer already supplies the newer value. Keep optimistic/draft state out
of an unconditional `apply`: merge independent changes or surface a conflict.

## Publish after commit

A JSON-store backend registers `createStoreChangeFeed` with its plugin name, an authenticated
`resolveDir(userId, sessionId)`, a committed-write subscription, and `ctx.watchPath` when available.
Register its `wsFrames` and release it through `onShutdown`. Never accept an absolute subscription
path or trust a user ID from the command payload. `acceptPath` can narrow a directory to the owning
user's file; coarse filesystem events invalidate conservatively.

The shared protocol uses commands `<plugin>:store.subscribe` and `<plugin>:store.unsubscribe`, frame
tag `c`, and `{ plugin, sessionId }` invalidations. A status frame additionally supplies `live`.
`sessionId: null` names installation-owned plugin state, not an arbitrary user's state. The socket's
authenticated user still governs resolution and reads. Frames never contain credentials or
documents.

`live: true` means the native source is covered, not merely that the host accepted a command.
Without a native watcher, committed API changes still arrive promptly but the reader keeps its
fallback for external file edits. Watcher failure and socket disconnect set liveness false.

Service-backed state uses an explicit mutation map with `observeMutations`. HTTP, agent tools and
internal callers must share that service instance or a shared publisher. Do not infer mutations from
HTTP verbs: a POST may generate a preview or perform a read. Notification failure cannot turn a
successful committed write into a failed mutation.

## Read and recover

`createResourceSync` from `ui/resource-sync` is shared with core. It coalesces invalidations,
serializes each registered reader, rejects superseded answers, aborts cancellable reads on teardown,
and retries failures with bounded delays. New invalidation bypasses a pending retry delay. Shared
resources use this scheduler too, including invalidations during their first load and cache reset
while a request is pending.

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

## Validate a plugin

Exercise initial subscription, edits from another window, agent/API writes, atomic file replacement,
bursts during an in-flight read, reconnect, scope changes, watcher failure and unmount. Assert that
an older answer cannot undo a newer mutation, a dirty draft survives, and a healthy idle resource
makes no periodic requests. Test user isolation and release both write and filesystem listeners.
