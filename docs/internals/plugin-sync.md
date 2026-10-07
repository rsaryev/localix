# Bundled plugin synchronization review

The common contract is [Plugin synchronization](../extending/plugin-sync.md). Core and plugins now
share read scheduling and successful service-mutation observation in the plugin SDK. Store wire
frames, feed subscriptions, validated route snapshots and JSON-store notifications also have one SDK
implementation; game/template modules retain thin compatibility exports.

## Inventory

This review covers all 21 bundled manifests. A row records the actual source coverage, rather than
assuming every timer can be removed.

| Plugin           | Change source and resulting policy                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API Client       | Project `.localix/api` watcher plus existing tool/topic signals. Lists use `useFileResourceSync`; healthy 120-second backstop removed; 15-second fallback remains.                                                                                                                                                                   |
| Resumes          | Project `.localix/resumes` watcher. Shared read coordinator replaces unconditional 5-second polling; drafts retain existing merge, recovery and conflict policies.                                                                                                                                                                   |
| Template         | Shared store feed, committed JSON writes and native storage watch. Healthy periodic reads removed; visible fallback remains.                                                                                                                                                                                                         |
| Chess            | Same shared store feed and validated snapshot hooks. Local clock display remains local.                                                                                                                                                                                                                                              |
| Checkers         | Same shared store feed and validated snapshot hooks.                                                                                                                                                                                                                                                                                 |
| Battleship       | Same shared store feed and validated snapshot hooks.                                                                                                                                                                                                                                                                                 |
| Tic-Tac-Toe      | Same shared store feed and validated snapshot hooks.                                                                                                                                                                                                                                                                                 |
| 2048             | Same shared store feed and validated snapshot hooks.                                                                                                                                                                                                                                                                                 |
| Learning         | Native session-storage watch covers imported course bundles and state. Existing tool/topic signal remains; minute fallback runs only without live coverage.                                                                                                                                                                          |
| Database         | Shared service observer covers connect/reconnect/rename/config/disconnect/remove from HTTP and tools. User-scoped storage watch expires saved-list cache. All windows hear changes; minute fallback is disabled while covered. External database rows and schema still require explicit query/reload or existing tool notifications. |
| Reader           | Native plugin-storage watch for `library.json` expires the shelf cache before re-read. Shelf and reading-pane library lists subscribe; unsupported watchers retain visible fallback. Source documents and reading statistics have their own caches/lifecycles.                                                                       |
| Code Graph       | Project watcher informs the index; revision stream informs the view. Healthy idle polling stops only when both sources are live. Indexing keeps 1.5-second progress sampling; lost coverage retains 8-second fallback.                                                                                                               |
| DevOps           | Docker inventory stops polling with healthy daemon events and no outstanding collection errors. Detail sampling and recovery remain. Kubernetes pod watch does not cover deployments, services, nodes or local port-forward processes; secondary refresh remains. Metrics sampling and pod content/error recovery remain.            |
| Git Workspace    | Project watcher and existing refresh coordinator. Two-minute healthy backstop remains for linked Git directories outside the project and watch depth limits; failed/evicted watchers now explicitly report not-live.                                                                                                                 |
| Project Space    | Existing revision stream plus file watcher; no healthy polling when both cover the board. Folder matching now uses the shared conservative matcher, including ancestor creation/removal. Existing serialized writes and revision protections remain.                                                                                 |
| Kanban           | Existing board socket and shared write-through board mirror; no periodic polling found. Keep domain-specific ordered operations rather than replacing them with generic last-write-wins.                                                                                                                                             |
| Trading          | Existing venue streams supply ticker, order book and candles. Delivery-aware fallback remains, as do contract statistics without a push source. The registered backend exposes public market data rather than credentialed connection management.                                                                                    |
| Documents        | Viewer state uses the host workspace/file lifecycle; its status item subscribes to local open-work-item state without network polling. Extraction, generated documents and table operations retain their owning services.                                                                                                            |
| Review           | Tool/hook workflow; no continuously polled workbench read model found.                                                                                                                                                                                                                                                               |
| Deliverable      | Tool/hook workflow; no continuously polled workbench read model found.                                                                                                                                                                                                                                                               |
| Webhook Notifier | Outbound hook workflow; no workbench snapshot polling found.                                                                                                                                                                                                                                                                         |

## Failure and ordering fixes

- Precise filesystem entry paths supplement the existing tree-directory event contract.
- Native watcher failure and LRU eviction publish `live: false`; socket disconnect immediately drops
  UI liveness, and late root-listing answers cannot restore an obsolete subscription.
- SDK caches retain invalidations during an initial/in-flight read, and reset/dispose reject late
  answers. Explicit refresh waits for an authoritative follow-up, rather than joining an obsolete
  read.
- Saved Database snapshots and Reader shelves expire on native changes before readback.
- Shared route snapshots reject old-scope answers and out-of-order mutation failures.
- Native watches and write listeners release on unsubscribe/shutdown. Missing native capability does
  not claim live coverage. Frame content is scope metadata, never the stored document or
  credentials.

Filesystem notifications are hints rather than a distributed compare-and-swap primitive. An external
writer must still respect the resume revision/schema contract; atomic rename prevents partial files
but cannot guarantee conflict-free arbitrary simultaneous writes from unrelated processes. Watch
failure retains fallback and reconnect/visibility recovery; healthy polling remains only where the
inventory names a real uncovered source.

## Resume agent review

An inspected creation turn required six resume calls, including two schema failures, and seven model
turns. End-to-end duration was 72.065 seconds; recorded tool execution summed to 19 ms. This locates
most delay in repeated model turns rather than resume persistence. A later successful result
contained two skill groups; all eleven technologies survived actual PDF and DOCX generation, and the
one-page PDF was visually inspected.

The tool description and skill now direct custom authors to `guide` first, explain section-specific
fields, require empty skill `bullets`, and reuse IDs/revision already returned by `init`. The
intended custom creation path is `guide` then one valid `init`; this is a protocol improvement, not
a measured claim that a new model run already completes in two calls. Private transcript and resume
data are not checked into the repository.
