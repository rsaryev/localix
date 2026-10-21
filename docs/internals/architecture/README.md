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
[audit](audit.md) lists today's exceptions.

| Id  | Rule                                                                                        | Check                                  |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| A1  | No package imports `apps/*`, `@/` or a plugin; no cycle between workspace packages.         | Partly enforced; cycles planned        |
| A2  | The core imports no React, Hono, Kysely, `bun:sqlite`, `node:*` or provider SDK.            | Provider SDK on `engine-loop` only     |
| A3  | Provider SDKs and model-catalog packages are imported only in `packages/engine-models`.     | Planned (today only `engine-loop`)     |
| A4  | Only `apps/api/src/bootstrap/` constructs another feature's repository or service.          | Planned, with a baseline               |
| A5  | Kysely is imported only by repository modules and migrations.                               | Planned, with a baseline               |
| A6  | No value-import cycle between API features.                                                 | Planned, with a baseline               |
| A7  | Domain and service code throws domain errors; only routes produce HTTP errors.              | Planned, with a baseline               |
| A8  | UI slices on the same layer do not import each other; outsiders use a slice's public entry. | Layer order enforced; the rest planned |
| C1  | A write to an owned entity records its notice in the same transaction.                      | Planned, with a baseline               |
| C2  | A notice names identity only: entity, op and ref.                                           | Enforced by the registry types         |
| C3  | Every consumer handles every kind or ignores it explicitly.                                 | Enforced by the registry types         |
| C4  | Every consumer has tests for a duplicate, a gap with reconcile, and a parent deletion.      | Planned                                |
| C5  | A follow-up in another feature runs in a consumer, unless it is a documented command.       | Planned, with a baseline               |
| C6  | Clients learn of changes from the relay; a write does not patch another surface's store.    | Planned, with a baseline               |
| C7  | Whether a route can run is decided once, by `routeReadiness` in `@localixai/agent/catalog`. | Planned                                |

## Enforcement

Rules become deterministic checks in `scripts/check-architecture.mjs` and source-reading tests. A
rule that the code already breaks starts with a baseline: a committed list of today's exceptions in
`scripts/` that may only shrink. A new exception fails with the rule id and how to fix it; a fixed
one must be removed from the list. This is the same ratchet the UI token guards use.

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
