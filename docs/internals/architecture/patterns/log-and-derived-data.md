# The log and derived data

An ordered, append-only log of changes lets many readers build their own derived stores at their own
pace. Read this note when a feature wants its own index, cache or read model of data that another
feature owns.

## Source

- Jay Kreps, "The Log: What every software engineer should know about real-time data's unifying
  abstraction", LinkedIn Engineering, 16 December 2013:
  https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying.
  The live URL returned HTTP 404 when fetched; the content was read from the Internet Archive copy
  of that URL.
- Martin Kleppmann, "Turning the database inside-out with Apache Samza", 4 March 2015 (transcript of
  a Strange Loop 2014 talk):
  https://martin.kleppmann.com/2015/03/04/turning-the-database-inside-out.html

## What the source says

Kreps defines a log as an append-only sequence of records in a total order, where the position acts
as a timestamp. If deterministic processes start in the same state and see the same inputs in the
same order, they end in the same state. Tables and logs are dual: applying a changelog in order
yields a table, and a table's updates can be published as a changelog. The value of the log is
"producing a persistent, re-playable record of history" (Kreps), which lets many systems read it at
their own rate.

Logs cannot grow forever: event data keeps a time window, and keyed data can be compacted to the
latest record per key. Partitions are ordered internally but not across each other.

Kleppmann treats replication, secondary indexes, caches and materialized views as derived data.
Indexes and views are maintained by the database; application caches are not, and he calls their
upkeep a mess: invalidation is brittle, concurrent writers and readers race, and cold caches flood
the database. His remedy is to make the ordered change stream the single write path, so every view
derives from the same order and can be rebuilt from it. He leaves cross-store transactions as an
open problem.

## Rules we take

- Every derived store (index, cache, read model) is fed from the change feed or from a reconcile
  against the owner, never from a second write in the producer.
- A derived store must be rebuildable: deleting it and reconciling must restore it.
- Each reader keeps its own position; no reader waits for another.
- Retention is explicit: notices are kept until every live cursor has passed them, plus a margin.
- Rely on order only within one stream.

## Pitfalls the source warns about

- Updating a database and a cache separately (dual writes) lets concurrent writers leave them in
  different orders.
- Filling a cache on read can overwrite newer data with a stale value.
- An unbounded log grows in space and replay time; compaction or a window is required, and both lose
  some history.
- There is no global order across partitions.
- Strict consistency across several derived stores is not solved by the log alone.

## How Localix applies it

- `change_events` is the log, ordered by `seq` and split into streams (`core`, `plugin:<name>`); see
  `packages/change-feed/src/feed.ts`.
- The semantic index is a derived store: `apps/api/src/bootstrap/semantic-changes.ts` subscribes it
  to the core stream, and `apps/api/src/features/embeddings/targets.ts` turns notices into index
  work.
- Retention in `prune` keeps notices for a day after every cursor has passed them, and drops cursors
  untouched for a month.
- Owners whose data changes outside the app announce `resync`
  (`apps/api/src/features/capabilities/changes.ts`), which plays the role of a compacted "all of
  this kind" record.

Related: [Projectors and reactors](projectors-and-reactors.md),
[Replay then live](replay-then-live.md).

## What we do not take

- **The log as source of truth.** Owners' tables remain primary; the log holds pointers, not facts,
  and is pruned. A reader that falls behind retention reconciles from the owner instead of replaying
  from the beginning.
- **Unbundling the database.** We do not route all writes through the log; producers write their
  tables and add a notice in the same transaction (see
  [Transactional outbox](transactional-outbox.md)).
- **Key-based compaction.** A day of retention after all cursors is small enough for a local SQLite
  database.
