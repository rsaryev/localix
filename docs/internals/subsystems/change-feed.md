# Change feed

The change feed tells consumers what changed, once, for every consumer: the semantic index today,
and any later reader (realtime, group chats looking up skills). Producers depend only on a
registry's types; consumers each read at their own cursor.

The engine is the `@localixai/change-feed` package (`packages/change-feed/src/index.ts`): notices,
recording, consumers and a test kit. The API keeps what is its own: the core registry, the plugin
streams and the retry policy (`apps/api/src/features/changes/retry.ts`).

## Notices

A notice is thin — `{ entity, op, ref }` — never the entity's state; a consumer reads what it needs
from the owner, so delivery is at least once and a duplicate does no harm.

| Op               | Meaning                                                                          |
| ---------------- | -------------------------------------------------------------------------------- |
| `upserted`       | Created or changed: re-read it                                                   |
| `deleted`        | Gone: the `ref` carries what cleanup needs                                       |
| `resync`         | Anything of this kind may have changed (files edited outside the app): reconcile |
| `parent-deleted` | Delivered, never recorded: a parent in the registry's `cascades` was deleted     |

The core registry (`features/changes/core-entities.ts`) declares each kind's ref schema and its
cascades: a chat's deletion takes its messages. A consumer's handlers are typed over the whole
registry, so a kind added to it fails to compile until every consumer gives it a handler or
`'ignore'`.

## Producing

`recordChanges(trx, stream, changes)` (`packages/change-feed/src/record.ts`) writes inside the
producer's own transaction: one small INSERT, so a notice exists exactly when its change committed.
It never throws — a failure is logged, SQLite undoes that one statement, the producer's write
commits, and the consumer's reconcile closes the gap. Core producers call `recordCoreChanges`; chat
writers use `chat/session-changes.ts`. Capability mutations all pass the capability revision, which
announces `resync` for skills, plugins, MCP servers and agents once a burst settles
(`capabilities/changes.ts`).

## Consuming

`createChangeFeed` (`packages/change-feed/src/feed.ts`) holds one stream's consumers. Each consumer
(`packages/change-feed/src/consumer.ts`) wakes a moment after a write, reads pages of 100 past its
cursor, yields to the event loop between pages (`bun:sqlite` is synchronous), and moves its cursor
in `change_cursors`. A handler that throws is retried from the same notice after the host's retry
delay; after five attempts the notice is skipped and logged. A malformed row is skipped. Notices
every consumer has read are pruned after a day; a cursor nobody moved in a month is dropped.

The notification journal shares the producing side's single writer (`lib/batch-writer.ts`): one
writer, a batch per transaction, a poisoned job losing only itself, outcomes reported after commit.

## Related guides

- [Architecture prospectus](../architecture/README.md): the change-feed architecture, its rules and
  the planned packages.
- [Pattern notes](../architecture/patterns/README.md): the published patterns this subsystem
  implements.
