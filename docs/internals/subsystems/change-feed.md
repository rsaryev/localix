# Change feed

The change feed tells consumers what changed, once, for every consumer: the semantic index, the
relay that pokes clients, and the reactors that repair or reap what a change leaves behind (listed
below). Producers depend only on a registry's types; consumers each read at their own cursor.

The engine is the `@localixai/change-feed` package (`packages/change-feed/src/index.ts`): notices,
recording, consumers and a test kit. The API keeps what is its own: the core registry, the mini app
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

## Kinds and consumers

| Kind                  | Owner records it                                             | Consumers                                     |
| --------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| `chat.session`        | Chat writers; deletion of a tree, one notice per id          | Semantic index, usage ledger, session residue |
| `chat.message`        | Inserts; edits, a turn's usage moving, the final flush       | Semantic index, usage ledger                  |
| `provider.connection` | Every connection or key change, deletion in its transaction  | Route repair, notifications cleanup, relay    |
| `project`             | Created, moved, renamed, deleted, restored                   | Mini app hosts, relay                         |
| `project.settings`    | A settings-only write, in its transaction                    | Relay                                         |
| `user.profile`        | Interface settings written, in the profile's transaction     | Relay                                         |
| `user.agent-settings` | Agent settings written, in the profile's transaction         | Relay                                         |
| `user.view-state`     | An accepted view-state write, by kind and key                | Relay                                         |
| `secret`              | A vault item created, rotated, edited or removed, by key     | Relay                                         |
| `system.toggle`       | A host control switched                                      | Relay                                         |
| `agent`               | Every write by handle, with the stable `agentId`; `resync`   | Semantic index, agent seats, relay            |
| `plugin`, `mcp`       | Removal from `capability_source`, by name; `resync`          | Semantic index, capability cleanup            |
| `mini-app`            | Installed, updated, removed or its settings changed, by name | Mini app hosts, capability cleanup, relay     |
| `skill`               | `resync` after a capability bump                             | Semantic index, relay                         |
| `capability.rule`     | Every rule-list write, by agent, in its transaction          | Relay                                         |
| `local.model`         | Installed or removed by id; `resync` at boot                 | Route repair                                  |

The consumers besides the semantic index are wired in `apps/api/src/bootstrap/core-reactors.ts`:

- `route-repair` (`features/chat/route-repair/`) rebinds seats, choice maps, project models and
  workload routes whose connection is gone, to the account `routeReadiness` calls ready, and
  surfaces loops whose chat no account can serve.
- `notifications-cleanup` settles the provider condition rows of a deleted connection.
- `agent-seats` (`features/chat/agent-seats/`) follows a renamed agent's handle; a deleted agent
  leaves shared rooms and its picks are forgotten.
- `capability-cleanup` (`features/capabilities/cleanup.ts`) drops a removed plugin's, mini app's or
  server's switches, MCP sign-in and vault bindings.
- `session-residue` (`features/chat/session-residue.ts`) reaps monitors, loops, inbox rows and the
  scratch directory of every id of a deleted chat tree.
- `mini-app-hosts` refreshes the mini app backend and channel hosts when a mini app is installed,
  updated or removed, when a rule switches one on or off, and when a project's scope moves.
- `relay` (`features/realtime/relay.ts`) pokes client topics; `usage-ledger`
  (`features/usage/ledger-projector.ts`) derives chat-turn ledger rows from their messages.

## Producing

`recordChanges(trx, stream, changes)` (`packages/change-feed/src/record.ts`) writes inside the
producer's own transaction: one small INSERT, so a notice exists exactly when its change committed.
It never throws — a failure is logged, SQLite undoes that one statement, the producer's write
commits, and the consumer's reconcile closes the gap. Core producers call `recordCoreChanges`; chat
writers use `chat/session-changes.ts`. Capability mutations all pass the capability revision, which
announces `resync` for skills, plugins, MCP servers and agents once a burst settles
(`capabilities/changes.ts`). A rule write bumps the revision itself, once, after its transaction;
`capabilitiesChanged()` is the one entry point a service mutation uses, and it does not bump again
inside a mutation that already did.

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
