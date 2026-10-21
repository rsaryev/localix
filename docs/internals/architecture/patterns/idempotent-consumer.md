# Idempotent consumer

An idempotent consumer produces the same outcome whether it handles a message once or many times.
Read this note when writing or reviewing a change-feed handler, a retry path, or anything that
reacts to a notice with a side effect.

## Source

- Chris Richardson, microservices.io, "Pattern: Idempotent Consumer":
  https://microservices.io/patterns/communication-style/idempotent-consumer.html
- Pat Helland, "Idempotence Is Not a Medical Condition", ACM Queue vol. 10 no. 4, 14 April 2012:
  https://queue.acm.org/detail.cfm?id=2187821. The live page returned HTTP 403 to automated fetches;
  the content was read from the Internet Archive copy of that URL.

## What the source says

Richardson: brokers that deliver at least once will redeliver, so a consumer may run several times
for one message, and "the outcome of processing the same message repeatedly must be the same as
processing the message once" (Richardson). A debit handler that subtracts on every delivery computes
a wrong balance. The remedy is to record processed message ids, keyed by subscriber and message, in
the same transaction as the business change, and to skip a message whose id is already present.

Helland: messages between loosely coupled systems are lost, retried, duplicated and reordered, and
every message is in effect delivered zero or more times. Consuming a message after processing is the
common case and requires idempotent processing, because a failure can land between the database
change and the acknowledgement. He distinguishes ordered delivery with no gaps (history) from
delivery of the latest value where gaps are acceptable (currency). Reading is idempotent; "process
withdrawal XYZ if not already processed" is idempotent while "withdraw" is not. Repeats may still
affect logs, heaps and load without breaking semantics.

## Rules we take

- Write every handler so that running it twice, or after a newer notice, leaves the same state.
- Prefer handlers that re-read current state and overwrite (upsert, delete by key) over handlers
  that apply deltas.
- When a handler causes an external effect, key it by the entity and its current state, not by the
  notice.
- Move the cursor only after the handler succeeds; accept the replay window this leaves.
- Decide per consumer whether it needs history or currency, and say so in its module comment.

## Pitfalls the source warns about

- Assuming the transport never drops or repeats messages leaves latent bugs.
- Delta-style handlers (increment, append, send) corrupt state under redelivery.
- Related messages may arrive out of order, even long after the first.
- Recording consumption before processing loses the message if processing fails.
- Repeated processing still costs resources and shows up in logs and metrics.

## How Localix applies it

- `packages/change-feed/src/consumer.ts` delivers, then saves the cursor; a crash between the two
  redelivers the page. A throwing handler is retried with backoff (`apps/api/src/lib/backoff.ts`) up
  to five attempts, then skipped and logged.
- Ops are designed for idempotence (`packages/change-feed/src/contracts.ts`): `upserted` means
  re-read, `deleted` carries the ref needed for cleanup, `resync` means reconcile the kind.
- The semantic index handlers in `apps/api/src/features/embeddings/targets.ts` re-embed or remove by
  key, which is safe to repeat.
- Tests for retry and redelivery live in `apps/api/src/features/changes/feed.test.ts`.
- On the client, `packages/plugin-sdk/src/ui/resource-sync.ts` coalesces invalidations and drops a
  read result that a newer invalidation has superseded.

Related: [Transactional outbox](transactional-outbox.md),
[Projectors and reactors](projectors-and-reactors.md).

## What we do not take

- **A processed-messages table.** Notices carry no payload to apply, so re-reading the owner makes
  dedup unnecessary. A future reactor with an external, non-repeatable effect (planned) would need
  its own key.
- **Gap-free history for every consumer.** After five failed attempts a notice is skipped; the
  consumer's reconcile restores currency rather than history.
