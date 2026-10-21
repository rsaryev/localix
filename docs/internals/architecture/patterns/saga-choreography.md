# Saga choreography

A saga carries a business operation across several local transactions; in choreography each step
reacts to the previous step's event, with no central coordinator. Read this note before chaining
consumers so that one reaction triggers another, or when a multi-step flow needs a result.

## Source

- Chris Richardson, microservices.io, "Pattern: Saga":
  https://microservices.io/patterns/data/saga.html
- Chris Richardson, "Managing data consistency in a microservice architecture using Sagas - part 3 -
  choreography-based sagas", microservices.io, 15 August 2019 (date taken from the URL; the page
  shows none): https://microservices.io/post/sagas/2019/08/15/developing-sagas-part-3.html

## What the source says

A saga is a sequence of local transactions that together keep data consistent when two-phase commit
is not available. If a step violates a business rule, compensating transactions undo the steps
already done. Two coordination styles exist. In choreography, each local transaction publishes
events that trigger the next steps in other services. In orchestration, a central orchestrator tells
each participant what to run next.

Drawbacks: there is no automatic rollback, so compensations must be designed; sagas lack isolation,
so concurrent sagas can see anomalies and need countermeasures; each step must update its database
and publish atomically, which is what an outbox or event sourcing provides; and a client that
started a saga synchronously needs a way to learn the result.

The part 3 article walks through a choreographed order: the order service creates a pending order
and emits an event, the customer service reserves credit and emits success or failure, and the order
service approves or rejects. It notes that the logic is spread across services, which makes larger
sagas harder to understand, and defers orchestration to a later post.

## Rules we take

- Do not build a multi-step business flow by chaining change-feed consumers; the feed reports facts,
  it does not coordinate work.
- When a flow needs a result, an order of steps or compensation, write it as one owner that calls
  the steps (orchestration) or issues commands.
- Keep each consumer's reaction local: update its own derived store, and stop there.
- If a consumer must cause a change in another feature, call that feature's typed port; its own
  notice then follows from its own transaction.
- Document any reaction chain longer than one hop in the consumer's module comment.

## Pitfalls the source warns about

- The flow is scattered across participants and hard to follow as it grows.
- No automatic rollback: every step that can fail later needs a designed compensation.
- No isolation between concurrent sagas.
- Each step depends on reliable, atomic publish; without it the saga stalls silently.
- A caller has no direct way to learn the outcome.

## How Localix applies it

- The only built-in chain is a cascade, not a saga: deleting a `chat.session` makes consumers of
  `chat.message` receive `parent-deleted` (`CORE_CASCADES` in
  `apps/api/src/features/changes/core-entities.ts`, expanded in
  `packages/change-feed/src/consumer.ts`). It removes derived data only and needs no compensation.
- Cross-feature behaviour goes through typed ports wired in the composition root, for example
  `apps/api/src/bootstrap/core-reactors.ts`, rather than through events that expect action.
- Atomic publish per step is provided by `packages/change-feed/src/record.ts`; see
  [Transactional outbox](transactional-outbox.md).

## What we do not take

- **Choreographed business sagas.** Localix runs in one process with one database, so a flow that
  needs several steps can use one transaction or an explicit orchestrating service. Choreography
  would add hidden flow (see [Event notification](event-notification.md)) with no benefit.
- **Compensating transactions on the feed.** Consumers maintain disposable derived data; correcting
  it means reconciling, not compensating.
