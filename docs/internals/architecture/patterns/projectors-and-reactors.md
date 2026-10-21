# Projectors and reactors

Change handlers come in two kinds: projectors maintain a read model, and reactors cause side
effects. Read this note when adding a consumer, choosing where its position lives, or planning a
rebuild of a derived store.

## Source

- Oskar Dudycz, "Consumers, projectors, reactors and all that messaging jazz in Emmett",
  event-driven.io, 1 December 2025: https://event-driven.io/en/consumers_processors_in_emmett/
- Oskar Dudycz, "Rebuilding Event-Driven Read Models in a safe and resilient way", event-driven.io,
  5 January 2026: https://event-driven.io/en/rebuilding_event_driven_read_models/

## What the source says

Dudycz separates delivery from work. A consumer connects to a source, reads or subscribes, batches,
and hands messages to processors; it holds no business logic and no checkpoint. A processor owns its
logic, its checkpoint, its error handling and its idempotency. Projectors turn events into queryable
read models; reactors trigger side effects such as sending an email. Each processor tracks its own
position, so processors move at their own pace, fail in isolation, and can be replayed by resetting
one checkpoint.

He lists the problems: a poison message either blocks a processor forever or is wrongly acknowledged
unless it can be skipped; a slow processor sharing a consumer causes redundant redelivery to the
others; concurrent instances of one processor can corrupt a read model.

On rebuilding, inline projections in the append transaction are consistent but slow appends and
couple failures. An in-place rebuild truncates and replays, leaving the model stale meanwhile; a
blue/green rebuild builds a new version alongside and switches once it has caught up. Rebuilds must
be coordinated with live processing and survive crashes, which he handles with locks plus a
persisted status.

## Rules we take

- Give each consumer its own name, cursor and failure state; never share a cursor between consumers.
- Say in each consumer's module whether it is a projector or a reactor.
- Keep projectors rebuildable from the owner; keep reactors safe to repeat or keyed.
- Bound retries, then skip and log, so one poison notice cannot stall a consumer.
- Run one instance of a consumer at a time.
- Prefer rebuilding a derived store beside the old one when its shape changes.

## Pitfalls the source warns about

- Poison messages with no skip path block processing.
- Processors with different speeds on one consumer cause redundant redelivery after restart.
- Several instances of the same processor corrupt read models.
- An in-place rebuild serves stale or empty data until it finishes.
- New events arriving during a rebuild, or a crash mid-rebuild, can corrupt state without
  coordination.
- Replay can re-trigger side effects; the source does not cover how to guard against it.

## How Localix applies it

- `packages/change-feed/src/feed.ts` is the delivery side for one stream; `subscribe` starts a named
  consumer and refuses a second subscription under the same name.
- `packages/change-feed/src/consumer.ts` gives each consumer its own reading loop and cursor row in
  `change_cursors`, so a slow or failing consumer does not hold back the others.
- The semantic index is a projector (`apps/api/src/bootstrap/semantic-changes.ts`). New consumers
  start at `now` by default and rely on their own reconcile for the past; `from: 'start'` replays
  what retention still holds.
- Poison handling: five attempts with backoff, then `changes.consumer_skipped` is logged and the gap
  is left to reconcile. A malformed row is skipped.
- Plugins subscribe through `apps/api/src/features/changes/plugin-host.ts`.

Related: [Idempotent consumer](idempotent-consumer.md),
[The log and derived data](log-and-derived-data.md).

## What we do not take

- **Inline projections.** Producers only insert a notice; projection work never runs in their
  transaction, so a projector failure cannot fail a write.
- **Checkpoint in the read model's transaction.** The cursor is saved after the handler; handlers
  are idempotent, so the replay window is acceptable.
- **Locks and status rows for rebuilds.** One process owns the database, and reconcile rebuilds from
  owners, not from the feed. A blue/green rebuild for a large index is planned only if needed.
- **A consumer/processor split.** One loop per consumer is simpler at our scale.
