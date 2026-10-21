# Localix architecture

Localix is built as an agnostic, layered core whose features announce what changed through one
durable change feed and react to each other only through it or through typed ports. This prospectus
states the principles, the vocabulary, the rules every change follows, and where the code stands
today; read it before changing how features, packages or surfaces depend on each other.

The design is not new: each part is a published pattern. The [pattern notes](patterns/README.md) and
[principle notes](principles/README.md) record what each source says and what we take from it. The
[audit](audit.md) measures the current code against the rules.

## Terminology

| Term        | Meaning                                                                        | Boundary                                                         |
| ----------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Core        | Domain packages and feature logic that decide what Localix does.               | Names no provider SDK, UI framework, transport or storage.       |
| Port        | A typed interface the core declares for something outside it.                  | Declared by the side that uses it, implemented by an adapter.    |
| Adapter     | Code that implements a port with a concrete technology.                        | Lives at the edge: `engine-models`, repositories, routes, UI.    |
| Owner       | The one feature that writes an entity and announces its changes.               | Every persisted entity has exactly one.                          |
| Notice      | A past-tense fact `{ entity, op, ref }` about a change.                        | Carries identity only, never state or an instruction.            |
| Change feed | The durable, ordered log of notices with one cursor per consumer.              | `change_events` and `change_cursors`; pruned, not an archive.    |
| Registry    | The entity kinds of a stream, their refs and cascades.                         | Every consumer must answer for every kind, or the build fails.   |
| Consumer    | A named reader of one stream that keeps its own cursor.                        | At-least-once delivery; must be idempotent and reconcilable.     |
| Projector   | A consumer that maintains derived data: an index, a ledger, client topics.     | Its output can be deleted and rebuilt from the owners.           |
| Reactor     | A consumer that performs a follow-up action: repair, cleanup, a notification.  | Never chains into a multi-step business flow.                    |
| Command     | A direct, synchronous call through a port.                                     | Only when the caller needs the result or an order of steps.      |
| Relay       | The projector that turns notices into client topics.                           | Sends pokes; clients pull the state.                             |
| Composition | The one place that builds adapters and wires ports: `apps/api/src/bootstrap/`. | Features do not construct each other's repositories or services. |

## Principles

| #   | Principle                        | Rule in one line                                                                   | Notes                                                                                            |
| --- | -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P1  | Agnostic core                    | The core depends on ports, never on a provider, UI framework, transport or store.  | [Agnostic core](principles/agnostic-core.md)                                                     |
| P2  | Dependencies point inward        | Source dependencies cross a boundary only toward the core.                         | [Clean Architecture](principles/clean-architecture.md)                                           |
| P3  | Ports and adapters               | Every technology is reached through a port; adapters translate at the edge.        | [Hexagonal](principles/hexagonal-ports-and-adapters.md)                                          |
| P4  | Layers inside domain modules     | Organize by feature first; presentation, domain and data layers inside each.       | [Layering](principles/layering.md), [Feature-Sliced Design](principles/feature-sliced-design.md) |
| P5  | One owner per model              | A model has one owner; other features use its contract or its notices.             | [Bounded context](principles/bounded-context.md)                                                 |
| P6  | Acyclic, stable dependencies     | No cycles between packages or features; depend toward the stable side.             | [Package principles](principles/package-principles.md)                                           |
| P7  | Owners announce, consumers react | A write records its notice in its own transaction; reactions live in consumers.    | [Event notification](patterns/event-notification.md), [Outbox](patterns/transactional-outbox.md) |
| P8  | Repeats are harmless             | Every consumer gives the same result on a duplicate, a gap or a newer notice.      | [Idempotent consumer](patterns/idempotent-consumer.md)                                           |
| P9  | Derived data is rebuildable      | Indexes, ledgers and caches can be deleted and rebuilt from their owners.          | [Log and derived data](patterns/log-and-derived-data.md)                                         |
| P10 | References keep stable identity  | Store the identity that survives recreation; an id that can be reissued is a hint. | [Domain event](patterns/domain-event.md)                                                         |
| P11 | Clients are poked, then pull     | Realtime frames name what changed; the client re-reads it from the owner.          | [Poke and pull](patterns/poke-and-pull.md), [Catch-up](patterns/replay-then-live.md)             |
| P12 | One writer per client store      | A UI store slice has one writer; no surface patches another surface's store.       | [Poke and pull](patterns/poke-and-pull.md)                                                       |

P10 in practice: a model route is identified by the pair (provider, model). Its connection id is a
hint that the resolver may replace with another live connection of the same provider, as
`resolveLanguageModel` in `apps/api/src/features/chat/runtime/model-resolution.ts` already does.

## What it is, and what it is not

| Pattern                                   | Status in Localix | Why                                                                      |
| ----------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| Event notification over an outbox         | Adopted           | Owners keep their tables as truth; notices point at what to re-read.     |
| Projectors and reactors with cursors      | Adopted           | Each reaction has its own position, retries and reconcile.               |
| Poke and pull, with catch-up on reconnect | Adopted           | Clients never trust a frame for state; a missed poke cannot strand them. |
| Commands through ports                    | Kept              | Ordered steps and answers the caller needs stay synchronous and typed.   |
| Choreography sagas for business flows     | Not adopted       | Event chains are hard to follow; flows that need order use a command.    |
| Event-carried state transfer              | Not adopted       | Copies of state in events drift from their owner.                        |
| Event sourcing                            | Not adopted       | Tables remain the source of truth; the feed is pruned after a day.       |

## Shape of the system

| Layer               | Contents                                                                    | May depend on                       |
| ------------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| Contracts and core  | `packages/agent`, `packages/engine-loop`, pure domain modules               | Other core packages, zod            |
| Adapters (packages) | `packages/engine-models`, `packages/engine-scripts`, `packages/engine`      | Core packages, their own SDKs       |
| Shared libraries    | `packages/kit`, `packages/plugin-sdk`, `packages/markdown`, other libraries | Lower libraries; never `apps/*`     |
| API features        | `apps/api/src/features/*`: routes → service → domain → repository           | Ports of other features, packages   |
| API composition     | `apps/api/src/bootstrap/`: builds adapters, wires ports and consumers       | Everything in the API               |
| UI                  | `apps/ui/src`: shared → features → widgets → pages → app                    | Lower layers only                   |
| Plugins             | `plugins/*`: backend, tools and UI through `plugin-sdk`                     | `plugin-sdk`, `agent`, a few others |

Inside an API feature, a route translates HTTP to a service call, the service applies domain rules
through ports, and only the repository touches Kysely. Errors are domain errors in the core; routes
map them to HTTP.

## Where the building blocks live

| Building block          | Home                                                                                     | Contents                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Change feed engine      | `@localixai/change-feed` (`packages/change-feed/src/index.ts`)                           | Notices, registry types, recording, projector and reactor consumers, reconcile, dead letters, consumer health, rebuild, and a test kit. |
| Route readiness         | `@localixai/agent/catalog` (`packages/agent/src/catalog/route-readiness.ts`)             | Whether a stored model route can run now, and on which connection; shared by the server and the UI.                                     |
| Client resource sync    | `@localixai/plugin-sdk/ui/resource-sync` (`packages/plugin-sdk/src/ui/resource-sync.ts`) | The scheduler every read model uses; after a reconnect whose frames were replayed it re-reads only what the outage cut off.             |
| Core registry and relay | `apps/api/src/features/changes/core-entities.ts`, `apps/api/src/features/realtime/`      | The core entity kinds; the relay from notices to client topics is planned there.                                                        |

Route readiness and resource sync were planned as packages of their own. Each already had a shared
home that both the API and the UI import, so a new package would only have moved or copied code.

## Rules

Each rule has an id that checks and reviews refer to. A rule marked Planned has no check yet; the
number beside an enforced rule is the size of its baseline today, and the [audit](audit.md) lists
the exceptions in prose.

| Id  | Rule                                                                                        | Check                                |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| A1  | No package imports `apps/*`, `@/` or a plugin; no cycle between workspace packages.         | Enforced; cycles with a baseline (0) |
| A2  | The core imports no React, Hono, Kysely, `bun:sqlite`, `node:*` or provider SDK.            | Enforced with a baseline (0)         |
| A3  | Provider SDKs and model-catalog packages are imported only in `packages/engine-models`.     | Enforced with a baseline (0)         |
| A4  | Only `apps/api/src/bootstrap/` constructs another feature's repository or service.          | Enforced with a baseline (0)         |
| A5  | Kysely is imported only by repository modules and migrations.                               | Enforced with a baseline (0)         |
| A6  | No value-import cycle between API features.                                                 | Enforced with a baseline (0)         |
| A7  | Domain and service code throws domain errors; only routes produce HTTP errors.              | Enforced with a baseline (0)         |
| A8  | UI slices on the same layer do not import each other; outsiders use a slice's public entry. | Enforced with a baseline (0)         |
| C1  | A write to an owned entity records its notice in the same transaction.                      | Enforced with a baseline (3)         |
| C2  | A notice names identity only: entity, op and ref.                                           | Enforced by the registry types       |
| C3  | Every consumer handles every kind or ignores it explicitly.                                 | Enforced by the registry types       |
| C4  | Every consumer has tests for a duplicate, a gap with reconcile, and a parent deletion.      | Enforced with a baseline (1)         |
| C5  | A follow-up in another feature runs in a consumer, unless it is a documented command.       | Planned, with a baseline             |
| C6  | Clients learn of changes from the relay; a write does not patch another surface's store.    | Enforced with a baseline (0)         |
| C7  | Whether a route can run is decided once, by `routeReadiness` in `@localixai/agent/catalog`. | Enforced with a baseline (1)         |

### Durable turn queue

Every turn that does not start in an idle session waits in the session's durable queue
([`wake-queue/`](../../../apps/api/src/features/chat/runtime/wake-queue), stored by
[`wake-queue-repository.ts`](../../../apps/api/src/features/chat/runtime/wake-queue-repository.ts)).
A drain claims the head band with a lease, writes the turn under transcript ids derived from the
band, and acknowledges the rows afterwards. A crash between the write and the acknowledgement
replays the same rows, so delivery is at least once and the transcript stays idempotent. The queue
keeps these rules:

- A band claimed together keeps its batch name until it is acknowledged. Send-now and priority
  changes refuse a batched row, and removal takes the whole batch.
- A lease lasts 60 seconds and is renewed while a delivery or a steering reservation is held. A
  claim lost to another owner drains again when that owner's lease expires.
- A band that fails three consecutive deliveries is parked as `failed`. It leaves the head, appears
  as failed in the queue snapshot, and waits for the person to retry or remove it.
- An agent turn ticket is the documented exception. Its row is acknowledged **before** the run
  starts, so dispatch is at most once and a crash never replays tools. Once the run has started, the
  boot sweep marks it `interrupted` and posts a notice in the transcript. The acknowledgement
  records the reply slot (`agent_turn_starts`) in its transaction and the dispatch clears it when
  the run returns; a slot left at boot with no run record replaces its empty placeholder with a
  notice that offers a retry (`runtime/unstarted-turns.ts`).

A wake a trigger, a plugin or a background job asks for under a delivery key is recorded in
`wake_outbox` before it is sent
([`delivery.ts`](../../../apps/api/src/features/triggers/delivery.ts)). The queue's admission
deletes the row in its own transaction; a boot redelivers what is left under the same key. A
once-ever `receipt` delivery (a child's report) keeps its own recovery.

## Enforcement

Rules become deterministic checks in `scripts/check-architecture.mjs` and source-reading tests. A
rule that the code already breaks starts with a baseline: a committed list of today's exceptions in
`scripts/` that may only shrink. A new exception fails with the rule id and how to fix it; a fixed
one must be removed from the list. This is the same ratchet the UI token guards use.

The rule checks are `scripts/architecture-rules.test.ts` (A1 cycles, A2–A7) and
`scripts/architecture-flow-rules.test.ts` (A8, C1, C4, C6, C7), both run by `bun run test:repo`.
Their detectors live in `scripts/architecture/` and their baselines in
`scripts/architecture-baselines/<rule>.json`. Each key names a file or an edge, never a line, so an
unrelated edit does not churn it, and each rule has a positive control that proves it still fires.
After a fix, rewrite the baselines with `ARCHITECTURE_BASELINE=write` set on the same `bun test`
command and check that the diff only removes entries. Scope notes:

- A5 counts value imports of `kysely`; an `import type { Kysely }` handle passed into a module is
  allowed.
- A6 records every edge inside a cycle of value imports between features; type-only imports are
  excluded. A shape several features share lives in `apps/api/src/contracts/`, outside every
  feature, and a value a lower feature needs from a higher one arrives as a port.
- A7: services throw the domain errors in `apps/api/src/lib/domain-errors.ts` (`NotFoundError`,
  `ConflictError`, …). `DOMAIN_ERROR_STATUS` is the one place a kind meets an HTTP status, and the
  errors stay `ApiError`s, so every handler answers with the same status and body.
- C1 knows the tables of registered entities from `FEED_TABLES` in
  `scripts/architecture/flow-rules.ts`; a new registry kind adds its tables there.
- C6 allows the private store writers only in the chat store's sync layer
  (`apps/ui/src/entities/chat/model/sessionSync.ts`) and in the store that defines them. A server
  answer that a caller needs at once lands through `applyServerSession` or `applyServerProjects`.

Checks that hold today and back these rules:

- `kitBoundaryProblem`, `pluginSdkLayerProblem`, `pluginHostBoundaryProblem` and
  `pluginWorkspaceImportProblem` keep packages and plugins inside their boundaries.
- `ENGINE_LAYERS` limits each engine package's workspace imports, and only the composition root may
  import the engine.
- The UI layer check rejects an import from a higher layer.
- `apps/api/src/features/host-boundaries.test.ts` keeps three features from importing the chat
  feature.
- The registry types (`packages/change-feed/src/contracts.ts`) make every consumer answer for every
  entity kind.

## Roadmap

| Stage | Scope                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Fix the composer gate to the server's route rule; apply the setup model pick to the chat under it.                                                 |
| 1     | Building blocks: the change-feed package, route readiness and resync after replay (done); then the checks for the rules above with baselines.      |
| 2     | New registry kinds (provider connection, project, agent, MCP, plugin, skill, capability rule, local model) recorded in their owners' transactions. |
| 3     | Reactors: route repair, notification cleanup, capability cleanup, session residue; the relay replaces the mutation wrappers.                       |
| 4     | Projectors for usage; UI stores move to one writer per resource; baselines shrink to zero.                                                         |

## Related guides

- [Architecture overview](../architecture.md)
- [Code map](../code-map.md)
- [Change feed subsystem](../subsystems/change-feed.md)
- [Client and server synchronization](../client-server-sync.md)
- [Pattern notes](patterns/README.md)
- [Principle notes](principles/README.md)
- [Architecture audit](audit.md)

## Source of truth

- [Change feed engine](../../../packages/change-feed/src/feed.ts)
- [Consumer loop](../../../packages/change-feed/src/consumer.ts)
- [Core entity registry](../../../apps/api/src/features/changes/core-entities.ts)
- [Client resource sync](../../../packages/plugin-sdk/src/ui/resource-sync.ts)
- [Architecture checks](../../../scripts/check-architecture.mjs)
