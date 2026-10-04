# `@localixai/agent-runtime-pi`

This workspace-private package adapts the Pi model and agent libraries to the framework-neutral
ports in `@localixai/agent`. It is internal to Localix and is not intended for external consumption.

## Consumers

The only direct application importer is `apps/api/src/bootstrap/infra.ts`. That composition root
creates the agent runtime, auxiliary language-model factory, authentication runtime, and model
catalog used by API services.

## Entry points

| Import                                          | Contract                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@localixai/agent-runtime-pi`](./src/index.ts) | Factories for agent runs, buffered completions, authentication, credential stores, request-scoped model collections, and catalog listing; credential conversion and store bridging; adapter options and catalog metadata-cache types. |

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
- `listPiCatalog()` starts a background request for OpenRouter metadata (release dates, published
  reasoning levels) and never waits for it: it answers from the optional metadata store, or from the
  generated Pi data. A landed answer bumps `piCatalogRevision()` (the engine's `catalogRevision`),
  which is what a host keys its catalog cache on. Each provider's `env` lists the variables its own
  auth resolver accepts as a plain API key.
- Model execution is limited to models registered by the Pi collections; adapter errors are
  normalized to the contracts in `@localixai/agent/runtime`.

## Source of truth

- [`package.json`](./package.json) defines the single supported import path.
- [`src/index.ts`](./src/index.ts) defines the public factories and option types.
- [`src/runtime.ts`](./src/runtime.ts), [`src/auth.ts`](./src/auth.ts), and
  [`src/models.ts`](./src/models.ts) own execution, credential, and catalog behavior.
