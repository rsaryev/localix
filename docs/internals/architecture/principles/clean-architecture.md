# Clean Architecture

Clean Architecture arranges code in concentric rings and lets source dependencies point only toward
the centre. Localix uses it to keep the agent model and the engine loop free of the HTTP server, the
database, the UI and any model provider.

## Source

Robert C. Martin, "The Clean Architecture", The Clean Code Blog, 13 August 2012.
<https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html>

## What the source says

The article draws four rings. Entities hold business rules that would survive any single
application. Use cases hold application-specific rules and orchestrate entities. Interface adapters
convert data between the shape the use cases want and the shape a database, web framework or view
wants. Frameworks and drivers form the outer ring and are mostly glue. The number of rings is not
fixed; the direction is.

Martin's dependency rule is that "source code dependencies can only point inwards". An inner ring
does not name a function, class, variable or data format declared in an outer ring.

When control has to flow outward, for example from a use case to a presenter or a repository, the
inner ring declares an interface and the outer ring implements it. This is dependency inversion at
each boundary. Data that crosses a boundary travels as simple structures shaped for the inner ring,
never as database rows or framework objects.

## Rules we take

- Keep `packages/agent` free of every other `@localixai/*` package and of any relative path outside
  itself.
- Declare a port in the inner module when it needs an outer capability; implement it in an adapter
  and wire it in the composition root.
- Let only `apps/api/src/bootstrap.ts` and `apps/api/src/bootstrap/*` import `@localixai/engine*`.
- Pass plain records across a port; do not pass Kysely rows, Hono contexts or provider SDK objects
  into the agent or engine layers.
- Allow at most type-only imports from `features/agent-core` into a host feature such as
  `features/chat`.

## How Localix applies it today

The innermost ring is `packages/agent`: provider-neutral types, messages, tools and the
`AgentRuntime` and `ModelSession` interfaces in `packages/agent/src/runtime/index.ts` and
`packages/agent/src/runtime/model-session.ts`. Its manifest depends on no other workspace package.
`scripts/check-architecture.mjs` reports "the agnostic agent crosses its package boundary" and "the
agnostic agent imports engine/host module" for any violation.

The engine packages implement those ports. `ENGINE_LAYERS` in the same script lists, for each of
`packages/engine-loop`, `packages/engine-models`, `packages/engine-scripts` and `packages/engine`,
the only workspace packages it may import, and forbids the loop from naming `ai`, `@ai-sdk/*` or a
model-catalog package.

The composition root, `apps/api/src/bootstrap.ts` with its phases in `apps/api/src/bootstrap/`,
selects concrete infrastructure. The checker fails with "only the API composition root may import
the engine" elsewhere. Inside the API, `apps/api/src/features/agent-core/agnostic-boundary.test.ts`
proves that agent-core never value-imports `features/chat`; tools reach the host through ports built
in `apps/api/src/features/chat/runtime/run/runtime-tool-ports.ts`.

## Known gaps

- The checker reads import text. It does not prove that data crossing a port is a plain structure.
- Persistence is not behind ports everywhere: 91 non-test files under `apps/api/src/features` import
  `kysely` directly (measured 2026-10-21), so many feature services and their repositories share a
  module.
- See [the architecture overview](../../architecture.md) for the composition phases and
  [hexagonal ports and adapters](hexagonal-ports-and-adapters.md) for the port vocabulary.
