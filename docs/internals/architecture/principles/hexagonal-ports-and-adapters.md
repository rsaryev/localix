# Hexagonal ports and adapters

The application talks to the outside world only through ports it defines, and an adapter per
technology translates each port. Localix uses this to swap model providers, hosts and storage
without changing the agent loop, and to test the core with in-memory adapters.

## Source

Alistair Cockburn, "Hexagonal architecture" (also "Ports and Adapters"), first published 2005.
<https://alistair.cockburn.us/hexagonal-architecture/>

## What the source says

Cockburn states the intent as allowing an application to be driven equally by users, programs,
automated tests or batch scripts, and "to be developed and tested in isolation from its eventual
run-time devices and databases".

A port is a purposeful conversation the application holds with the outside, defined as an API. An
adapter converts between that API and one technology: a GUI, a test harness, a SQL database or an
in-memory mock. One port can have many adapters.

Primary, or driving, actors start the conversation; their ports are the application's offered API.
Secondary, or driven, actors are called by the application, for example a repository or a
notification service; their ports are interfaces the application requires. The distinction is who
initiates, not what technology is involved.

Tests drive the application through primary ports while mocks fill secondary ports, so regression
suites run without a UI or a live database. The hexagon is a drawing convention; Cockburn suggests a
small number of ports rather than one per use case.

## Rules we take

- Name every secondary dependency of the agent loop as an interface in `packages/agent` or in the
  consuming feature, never as a concrete import.
- Keep one adapter per technology behind each port; select it in the composition root.
- Give each optional tool capability its own key in `OptionalToolPorts` and build it in the host.
- Provide an in-memory or scripted adapter for each secondary port the tests rely on.
- Keep primary adapters (Hono routes, the WebSocket RPC, plugin entry points) free of domain rules;
  they translate and delegate.

## How Localix applies it today

Primary ports: the API exposes typed Hono routes consumed by `apps/ui/src/shared/api/client.ts`;
`scripts/api-contract-guard.test.ts` keeps the UI on that typed client. Plugins drive the host
through contracts in `packages/plugin-sdk/src/manifest/index.ts`.

Secondary ports: `AgentRuntime` in `packages/agent/src/runtime/index.ts` and `ModelSession` in
`packages/agent/src/runtime/model-session.ts`. The engine is one adapter, created by `createEngine`
in `apps/api/src/bootstrap/agent-engine.ts`. Provider SDKs (`@ai-sdk/*`,
`@openrouter/ai-sdk-provider` and the model-catalog packages) appear only in
`packages/engine-models`.

Tool ports: `apps/api/src/features/agent-core/tool-registry.ts` declares `OptionalToolPorts`, and
`apps/api/src/features/chat/runtime/run/runtime-tool-ports.ts` implements them for the chat host.

UI platform ports: `apps/ui/src/shared/lib/platformCapabilities.ts` wraps clipboard, external links
and reload. `scripts/check-architecture.mjs` reports "direct clipboard access bypasses
platformCapabilities" and "direct openExternal import bypasses platformCapabilities".

Isolated runs: `bun run test:sessions` boots an isolated API with a scripted model (see
`scripts/session-e2e/README.md`).

## Known gaps

- Storage is mostly not a port: feature repositories import `kysely` directly, so a feature service
  is usually tested against a real SQLite database rather than an in-memory adapter.
- No check proves that a port has a test adapter.
- Related: [Clean Architecture](clean-architecture.md), [agnostic core](agnostic-core.md),
  [code map](../../code-map.md).
