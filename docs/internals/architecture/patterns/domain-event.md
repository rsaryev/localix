# Domain event

A domain event records that something meaningful happened in the domain, published by the code that
owns the change. Read this note when adding an entity kind to a registry or deciding what a producer
should announce.

## Source

- Chris Richardson, microservices.io, "Pattern: Domain event" (no date shown):
  https://microservices.io/patterns/data/domain-event.html
- Martin Fowler, "Domain Event", 12 December 2005 (draft material for Further Enterprise Application
  Architecture): https://martinfowler.com/eaaDev/DomainEvent.html

## What the source says

Richardson frames the problem as how a service publishes an event when it updates its data. The
answer is to organise business logic as aggregates that emit events when created or updated. Sagas
and CQRS views create the need; a [transactional outbox](transactional-outbox.md) publishes the
events atomically with the update.

Fowler describes a domain event as something that "Captures the memory of something interesting
which affects the domain" (Fowler). Input layers turn stimuli into events and log them; a processor
reads the log and drives behaviour, without knowing where the input came from. He separates
immutable source data from mutable processing data and from cached derived data, which must be
marked as disposable. He recommends recording both when an event happened and when it was noticed,
and correcting mistakes with a new retroactive event rather than editing the old one.

## Rules we take

- The owner of an entity announces its changes; no other module writes notices for it.
- Declare each kind once in a registry with a ref schema, and validate refs on read.
- Never edit or reuse a recorded notice; a later change is a new notice.
- Treat every derived store as disposable: it must be rebuildable from the owner.
- Record when a notice was written (`recorded_at`) so retention and debugging have a clock.

## Pitfalls the source warns about

- Adopting events is an architectural decision with its own programming style; the payoff is not
  guaranteed.
- Many event subtypes that share most of their data become tiresome to maintain.
- Unlabelled or ambiguous timestamps cause confusion later.
- Changing source data after the fact destroys the audit value of the log.
- Derived caches that are not marked as removable get treated as truth.

## How Localix applies it

- The core registry is `CORE_ENTITIES` in `apps/api/src/features/changes/core-entities.ts`:
  `chat.session`, `chat.message`, `skill`, `plugin`, `mini-app`, `mcp`, `agent`, each with a Zod ref
  schema.
- Mini apps get their own open registry and stream (`plugin:<name>`) through
  `apps/api/src/features/changes/plugin-host.ts`.
- Owners announce their own kinds: chat writers through
  `apps/api/src/features/chat/session-changes.ts`, capabilities through
  `apps/api/src/features/capabilities/changes.ts`.
- `packages/change-feed/src/consumer.ts` drops a row whose ref fails its schema instead of passing
  it on.
- The table shape is in `apps/api/migrations/20261027T000000_change_feed.ts`.

## What we do not take

- **Rich event types.** Our notices have two state ops (`upserted`, `deleted`) plus `resync`.
  Fowler's events carry domain facts; ours only point at the entity, because consumers re-read it
  (see [Event notification](event-notification.md)).
- **The event log as audit trail.** Notices are pruned after all consumers have read them, so the
  feed is not a history. Audit needs, if any, belong elsewhere.
- **Occurred-at versus noticed-at.** A notice is written in the owner's transaction, so the two
  times coincide; only `recorded_at` is stored.
