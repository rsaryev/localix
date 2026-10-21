# Change-feed patterns

These notes record where the change-feed design comes from: what each primary source says, the rules
we take from it, and what we leave out. Start with
[the change feed subsystem](../../subsystems/change-feed.md) for how the feed works today.

| Pattern                                               | Meaning                                                           | Primary source                                       | Where it lands in Localix                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| [Event notification](event-notification.md)           | Announce that something changed; receivers re-read from the owner | Martin Fowler, "What do you mean by 'Event-Driven'?" | Thin `{ entity, op, ref }` notices in `apps/api/src/features/changes/` |
| [Domain event](domain-event.md)                       | The owner of a change records it as a named domain fact           | microservices.io; Martin Fowler, "Domain Event"      | The core and plugin entity registries                                  |
| [Transactional outbox](transactional-outbox.md)       | Write the message in the same transaction as the change           | microservices.io; Oskar Dudycz, event-driven.io      | `recordChanges` into `change_events` with the producer's handle        |
| [Idempotent consumer](idempotent-consumer.md)         | Handling a message twice has the same effect as once              | microservices.io; Pat Helland, ACM Queue 2012        | Re-read handlers, cursor saved after delivery                          |
| [The log and derived data](log-and-derived-data.md)   | An ordered log feeds independent, rebuildable derived stores      | Jay Kreps, "The Log"; Martin Kleppmann               | Streams, per-consumer cursors, retention, the semantic index           |
| [Projectors and reactors](projectors-and-reactors.md) | Handlers either maintain a read model or cause a side effect      | Oskar Dudycz, event-driven.io                        | Named consumers with their own cursor and retry state                  |
| [Saga choreography](saga-choreography.md)             | Multi-step flows driven by events, with compensation              | Chris Richardson, microservices.io                   | Not used for business flows; cascades only                             |
| [Poke and pull](poke-and-pull.md)                     | A content-free hint makes the client pull authoritative state     | Replicache documentation                             | `resources.changed` and the UI resource sync                           |
| [Catch-up subscription](replay-then-live.md)          | Replay after the last position, then switch to live delivery      | Kurrent docs; Apache Kafka design; Replicache docs   | The consumer reading loop and client reconnect                         |

## Sources that needed a fallback

- Pat Helland's ACM Queue article returned HTTP 403 to automated fetches and was read from the
  Internet Archive copy of its URL.
- Jay Kreps's LinkedIn article returned HTTP 404 and was read from the Internet Archive copy of its
  URL.
- The Kafka `#design_consumerposition` anchor now serves a redirect page; the current 4.3 design
  page was used.

## What the project deliberately does not adopt

- **Event sourcing.** Owners' tables are the source of truth; the feed holds pointers and is pruned.
- **Event-carried state transfer.** Notices never carry entity content.
- **Choreographed sagas.** Multi-step work is orchestrated by an owner or done in one transaction.
