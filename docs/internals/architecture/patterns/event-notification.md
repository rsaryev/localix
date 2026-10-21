# Event notification

Event notification is the style where a component announces that something in its domain changed and
expects no reply. Read this note when deciding what a change notice may carry, or when a reviewer
asks why the feed does not send entity state.

## Source

- Martin Fowler, "What do you mean by 'Event-Driven'?", 7 February 2017:
  https://martinfowler.com/articles/201701-event-driven.html

## What the source says

Fowler separates four patterns that are often grouped under "event-driven":

- **Event notification.** A system tells others that its domain changed. The sender does not wait
  for a response; anything it needs back arrives indirectly. Coupling is low and setup is simple.
- **Event-carried state transfer.** The event carries the changed data, so receivers keep their own
  copy and never call the source. This gives resilience and lower latency, at the cost of many
  copies and more complex receivers. Fowler notes that calling the source when needed is often
  simpler.
- **Event sourcing.** Every state change is stored as an event, and the event store is the source of
  truth. State is rebuilt by replay. It gives an audit trail and historic states, but replay is hard
  when processing talked to outside systems, and event schemas must be evolved.
- **CQRS.** Separate models for reads and writes. It does not require events, and Fowler reports
  that it is often misused and confused with event sourcing.

He also stresses that none of these require asynchronous processing. About notification he writes:
"The danger is that it's very easy to make nicely decoupled systems with event notification"
(Fowler), without seeing the overall flow.

## Rules we take

- Send a notice that says what changed (`entity`, `op`, `ref`), never what it now contains.
- Let each consumer read current state from the owner when it handles a notice.
- Name the consumers of each kind in one place, so the flow stays visible in code.
- Use a notice to report a fact; use a direct call or command when the sender needs work done.
- Keep the four patterns apart in reviews: adopting notification does not commit us to CQRS or event
  sourcing.

## Pitfalls the source warns about

- The logical flow across several notices is not visible in any single module; it may only show up
  when watching a running system.
- An event used as a disguised command hides the sender's expectation that someone acts on it.
- Event-carried state multiplies copies and moves state-maintenance work into every receiver.
- CQRS and event sourcing add cost that is often blamed on the wrong pattern.

## How Localix applies it

- The notice type is `Change` in `packages/change-feed/src/contracts.ts`: `{ entity, op, ref }` with
  ops `upserted`, `deleted` and `resync`. A ref holds ids and scope only.
- The core kinds and their ref schemas live in `apps/api/src/features/changes/core-entities.ts`.
- Consumer handlers are typed over the whole registry (`ConsumerHandlers`), so every kind gets a
  handler or an explicit `'ignore'`. `apps/api/src/bootstrap/semantic-changes.ts` gathers the
  semantic index's targets in one map, which keeps the flow readable.
- Consumers re-read from owners; the same habit appears in
  `apps/api/src/features/chat/runtime/model-resolution.ts`, which resolves a live connection at the
  moment of use instead of trusting a stored id.
- The UI side follows the same shape: `resources.changed` in
  `apps/api/src/features/realtime/resources.ts` names read models and carries no payload.

See also [Domain event](domain-event.md), [Poke and pull](poke-and-pull.md) and
[the change feed subsystem](../../subsystems/change-feed.md).

## What we do not take

- **Event-carried state transfer.** Copies of entity state in notices would need versioning,
  ordering and privacy review for every field. Re-reading from the owner is simpler and makes
  duplicates and reordering harmless.
- **Event sourcing.** Owners keep their tables as the source of truth; notices are pruned after
  every consumer has read them.
- **CQRS as a goal.** Derived read models exist (the semantic index), but no separate write model is
  introduced.
