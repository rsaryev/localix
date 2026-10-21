# Transactional outbox

A transactional outbox writes the message about a change in the same database transaction as the
change itself, and a separate relay delivers it later. Read this note when adding a producer, or
when someone proposes publishing a notice after commit or from a different connection.

## Source

- Chris Richardson, microservices.io, "Pattern: Transactional outbox":
  https://microservices.io/patterns/data/transactional-outbox.html
- Chris Richardson, microservices.io, "Pattern: Polling publisher":
  https://microservices.io/patterns/data/polling-publisher.html
- Oskar Dudycz, "Outbox, Inbox patterns and delivery guarantees explained", 30 December 2020:
  https://event-driven.io/en/Outbox_Inbox_patterns_and_delivery_guarantees_explained/

## What the source says

Richardson's forces: two-phase commit across a database and a broker is often unavailable or
unwanted; a message must go out only if the transaction commits; and messages must keep the order in
which they were produced. The fix is an outbox table written inside the business transaction and a
relay that publishes from it. The relay may be a polling publisher, which queries the table
periodically and works with any SQL database but makes ordered publishing tricky, or transaction log
tailing.

Dudycz walks through delivery guarantees. At-most-once loses messages on failure. At-least-once
never loses them but can repeat them, so consumers must be idempotent. Exactly-once is very hard; in
practice it means at-least-once plus idempotent handling. An outbox alone is at-least-once, because
"mark as sent" can fail after a successful publish. For polling at scale he suggests a monotonic
event number and a per-consumer progress row, and notes that order holds only within a partition.

## Rules we take

- Write the notice with the producer's transaction handle, never after commit on another handle.
- Give every notice a monotonic sequence number and let consumers track their own position.
- Treat delivery as at-least-once everywhere; never promise exactly-once.
- Keep the relay idle-cheap: wake on a local signal, and poll only as a fallback.
- Make forgetting to record visible: a kind in the registry without a producer is a review question.

## Pitfalls the source warns about

- Developers can forget to publish after updating the database.
- The relay can publish a message twice, for example after a crash between publish and mark.
- Polling adds redundant load, and ordered publishing from a polled table needs care.
- Ordering is only guaranteed within one partition or stream.
- Deduplication through stored message ids costs an extra write and needs transactional storage.

## How Localix applies it

- `recordChanges` in `packages/change-feed/src/record.ts` inserts into `change_events` with the
  caller's `Transaction`. If the insert fails it logs and returns, so the producer's write still
  commits; the consumer's reconcile closes that gap.
- `change_events.seq` orders notices per stream; each consumer stores its position in
  `change_cursors` (`packages/change-feed/src/consumer.ts`).
- After a write, `onRecorded` wakes the stream's consumers; an idle poll every 30 seconds covers a
  missed wake. This is a polling publisher with a local doorbell.
- `publish` in `packages/change-feed/src/feed.ts` exists for owners with no transaction to join
  (files); it is fire-and-forget and relies on `resync`.
- Producer writes share one writer (`apps/api/src/lib/batch-writer.ts`).
- Retention (`prune`, scheduled by `apps/api/src/bootstrap/change-feed.ts`) removes notices every
  cursor has passed after a day.

See [Idempotent consumer](idempotent-consumer.md) for the consuming side and
[the change feed subsystem](../../subsystems/change-feed.md) for operational detail.

## What we do not take

- **A message broker.** Producers and consumers share one SQLite database in one process; the outbox
  table is the delivery channel, so there is no relay-to-broker step to fail twice.
- **An inbox table.** Consumers do not store processed ids; their handlers are idempotent by
  construction (they re-read the owner).
- **Transaction log tailing.** SQLite gives no change stream that we would want to depend on; the
  table plus sequence is enough.
