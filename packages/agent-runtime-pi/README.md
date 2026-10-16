# `@localixai/agent-runtime-pi`

This workspace-private package adapts the Pi model and agent libraries to the framework-neutral
ports in `@localixai/agent`. It is internal to Localix and is not intended for external consumption.

## Consumers

The only direct application importer is `apps/api/src/bootstrap/infra.ts`. That composition root
calls `createPiEngine` to compose the agent runtime, auxiliary language-model factory,
authentication runtime, and model catalog used by API services. Application features consume the
returned neutral ports rather than importing the adapter.

## Entry points

| Import                                          | Contract                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@localixai/agent-runtime-pi`](./src/index.ts) | Factories for agent runs, buffered completions, authentication, credential stores, request-scoped model collections, and catalog listing; credential conversion and store bridging; engine composition, model middleware, stop conditions, request preflight, stream watchdogs, and option types. |

## Limits

- Only the root import is exported. Message codecs, event translation, tool bridging, provider
  registration, and bounded-buffer helpers are adapter internals.
- Application and plugin code should depend on `@localixai/agent` contracts. This package belongs at
  the API composition root and does not own domain policy, persistence, or UI state.
- An agent run's terminal `result` settles independently of event iteration. Before a consumer
  starts iterating, the adapter retains a bounded window of 256 events by default; after attachment,
  the iterator applies backpressure.
- Credential refreshes reach durable storage only when the caller supplies a
  `RuntimeCredentialStore`; otherwise the adapter uses a request-scoped credential snapshot.
- The engine's catalog projects pi's providers: release dates are pi's `releaseDate`, reasoning
  levels are pi's `getSupportedThinkingLevels`, and requests clamp with pi's `clampThinkingLevel`.
  `listCatalog()` makes no network request. `refreshCatalog()` runs pi's `Models.refresh()`: with
  `allowNetwork: false` it restores the entries in the host's `catalogStore`; with
  `allowNetwork: true` the static built-ins fetch the generated catalog's sources and publish pi's
  own conversion of them (`@earendil-works/pi-ai/generated-catalog`). Persisted entries are checked
  against pi's model schema and tied to the catalog build that wrote them.
- Model execution is limited to models registered by the Pi collections; adapter errors are
  normalized to the contracts in `@localixai/agent/runtime`.

## Source of truth

- [`package.json`](./package.json) defines the single supported import path.
- [`src/index.ts`](./src/index.ts) defines the public factories and option types.
- [Engine composition](src/engine.ts) joins the four adapter ports and shared request tuning.
- [`src/runtime.ts`](./src/runtime.ts), [`src/auth.ts`](./src/auth.ts), and
  [`src/models.ts`](./src/models.ts) own execution and credential behavior;
  [`src/catalog.ts`](./src/catalog.ts) and [`src/catalog-store.ts`](./src/catalog-store.ts) own the
  catalog, its refresh, and its persistence.
