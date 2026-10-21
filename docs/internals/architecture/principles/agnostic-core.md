# Agnostic core

The Localix core knows its own model and the ports it needs, and nothing about which provider, UI
framework, transport or storage engine fulfils them. Those choices live in adapters at the edge and
are wired once in the composition root.

## Source

This note is a synthesis; it has no single external source. It rests on:

- [Clean Architecture](clean-architecture.md): dependencies point inward; inner rings declare
  interfaces that outer rings implement.
- [Hexagonal ports and adapters](hexagonal-ports-and-adapters.md): one port, many adapters; test the
  core with in-memory adapters.
- [Layering](layering.md): domain modules first; the domain does not depend on its data source.
- [Bounded context](bounded-context.md): one owner per model; translate at the edge.
- [Package principles](package-principles.md): stable, abstract packages at the bottom of an acyclic
  graph.

## What the sources say

Read together, the sources describe one property. Business rules sit at the centre and name only
abstractions. Every technology the system talks to is reached through a port the centre declares. An
adapter translates between that port and one technology, and swapping it must not change the centre.
The centre is the most depended-on and the most abstract part, so it must also be the most stable
and must not take part in dependency cycles.

For Localix, "the core" is `packages/agent`, the engine packages behind the `AgentRuntime` port, and
`apps/api/src/features/agent-core`. The four kinds of technology the core must not name are model
providers, UI frameworks, transports and storage engines.

## Rules we take

- Import a model provider SDK or catalog package (`ai`, `@ai-sdk/*`, `@openrouter/*`) only in
  `packages/engine-models`.
- Import no UI framework (`react`, `react-dom`) in `packages/agent`, `packages/engine*` or
  `apps/api/src/features/agent-core`.
- Import no transport (`hono`, WebSocket servers) and no storage engine (`kysely`, `bun:sqlite`) in
  `packages/agent`, `packages/engine*` or `apps/api/src/features/agent-core`.
- Choose concrete adapters only in `apps/api/src/bootstrap.ts` and `apps/api/src/bootstrap/*`.
- Name a model only in the owning catalogue (`apps/api/src/features/decisions/models.ts`,
  `apps/api/src/features/embeddings/models.ts`); consumers ask a port.

## How Localix applies it today

Providers: provider SDK imports appear only in `packages/engine-models` (29 files, measured
2026-10-21). `ENGINE_LAYERS` in `scripts/check-architecture.mjs` forbids `ai`, `@ai-sdk/*` and
model-catalog packages in `packages/engine-loop`.

UI framework, transport, storage: on 2026-10-21, no non-test file in `packages/agent/src`,
`packages/engine-loop/src` or `apps/api/src/features/agent-core` imports `react`, `hono`, `kysely`
or `bun:sqlite`. `packages/agent` may import no `@localixai/*` module, as the checker reports.

Composition: the checker allows `@localixai/engine*` only in the composition root.
`apps/api/src/features/agent-core/agnostic-boundary.test.ts` keeps agent-core from value-importing
the chat host. In the UI, platform access goes through
`apps/ui/src/shared/lib/platformCapabilities.ts`, and `kitBoundaryProblem` keeps `packages/kit`
independent of the apps that use it.

## Known gaps

- Only the provider ban on `packages/engine-loop` is a check. The bans on React, Hono, Kysely and
  SQLite in the core hold today but are not enforced, and the provider ban does not cover
  `apps/api/src/features/agent-core`.
- Features outside the core import `kysely` and `hono` directly; they are agnostic of providers but
  not of storage or transport.
- See [the architecture overview](../../architecture.md) and [the code map](../../code-map.md).
