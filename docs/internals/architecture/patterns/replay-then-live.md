# Catch-up subscription (replay then live)

A catch-up subscription first reads the durable log after the reader's last known position, then
switches to live delivery, with a marker when it has caught up. Read this note when a consumer or
client must resume after a restart or disconnect without losing or reordering changes.

## Source

- Kurrent (formerly EventStoreDB), "Catch-up Subscriptions", Node.js client documentation:
  https://docs.kurrent.io/clients/node/v1.0/subscriptions
- Apache Kafka documentation, Design, sections "Consumer Position" and "Message Delivery Semantics":
  https://kafka.apache.org/43/design/design/. The requested anchor
  https://kafka.apache.org/documentation/#design_consumerposition now serves a redirect page; the
  content was read from the current 4.3 design page.
- Replicache documentation, "How Replicache Works": https://doc.replicache.dev/concepts/how-it-works

## What the source says

Kurrent: a subscription replays existing events from a starting point, then delivers new ones as
they are written. It can start at the beginning, at the end (live only) or after a given position;
positions are exclusive. A `caughtUp` signal marks the switch from history to live, and fires at
once when subscribing from the end. A subscription can drop on error or when a slow reader overflows
its buffer; the reader stores its last processed position and resubscribes from it.

Kafka: the broker does not track per-message acknowledgements. A consumer's position in a partition
is one integer, the next offset to read, checkpointed periodically, and a consumer can rewind to
re-read. Saving the position before processing gives at-most-once; processing before saving gives
at-least-once, where "Messages are never lost but may be redelivered" (Kafka docs). Storing the
position with the output avoids two-phase commit.

Replicache: the client sends a cookie naming the state it holds and receives a patch to the current
state plus a new cookie, so resuming is a pull from the last cookie.

## Rules we take

- Store each reader's position durably and resume strictly after it.
- Save the position after the handler succeeds (at-least-once), never before.
- Place a new reader's position before it starts reading, so "from now" is well defined.
- Distinguish catching up from live in the reader's state when callers care about the difference.
- When the position is older than retention, reconcile from the owner instead of replaying.
- Treat a dropped live connection as a resume from the stored position, not a fresh start.

## Pitfalls the source warns about

- Saving the position before processing loses work on a crash.
- Processing before saving repeats work on a crash; handlers must be idempotent.
- A slow reader can overflow a live buffer and be dropped.
- "Exactly once" claims often fail once consumers, producers or disks can fail.
- Positions are only comparable within one ordered stream or partition.

## How Localix applies it

- `packages/change-feed/src/consumer.ts` is a catch-up reader: `loadCursor` resumes from
  `change_cursors`, pages of 100 rows past the cursor are read until empty, then the reader waits
  for a wake signal or a 30 second idle poll. The cursor is saved after delivery.
- `subscribe` in `packages/change-feed/src/feed.ts` takes `from: 'now' | 'start'` and resolves once
  the cursor is placed; `settle` resolves when a consumer has caught up (tests, shutdown).
- On the client, `apps/ui/src/shared/api/eventSocket.ts` reconnects the event socket and resyncs the
  sessions a surface watches; `apps/ui/src/shared/api/resourceSyncTransport.ts` calls `connected()`
  in `packages/plugin-sdk/src/ui/resource-sync.ts`, which invalidates every registered resource.
  This is a reconcile on reconnect rather than a replay.
- An explicit caught-up marker for clients reading the change feed is planned.

Related: [The log and derived data](log-and-derived-data.md), [Poke and pull](poke-and-pull.md),
[Idempotent consumer](idempotent-consumer.md).

## What we do not take

- **Event sourcing.** A catch-up reader here replays pointers to changes, not the facts that make up
  state; owners' tables remain the source of truth and the log is pruned.
- **Replay from the beginning of time.** Retention is about a day after all cursors; older history
  comes from reconcile.
- **Per-aggregate positions.** One sequence per stream is enough for our consumers.
