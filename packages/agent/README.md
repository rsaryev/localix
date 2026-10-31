# `@localixai/agent`

This workspace-private package defines Localix's framework-neutral agent contracts and shared pure
helpers. It is internal to this monorepo and is not intended as a supported external SDK.

## Consumers

The API, browser UI, plugin SDK, runtime adapter, and bundled workbench plugins import this package.
They share message, item, tool, runtime, catalog, context, and usage contracts without depending on
an application layer.

## Entry points

| Import                                                           | Contract                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@localixai/agent`](./src/index.ts)                             | Root barrel for wire and chat types, runtime and catalog contracts, context APIs, stream payloads, usage accounting, cache helpers, and utilities. |
| [`@localixai/agent/types`](./src/types.ts)                       | Provider-wire messages, content parts, tool calls and results, usage, stop reasons, reasoning effort, and message constructors.                    |
| [`@localixai/agent/chat`](./src/chat.ts)                         | Persisted chat messages, assets, context and invocation bindings, structured data parts, tool errors, and presentation helpers.                    |
| [`@localixai/agent/chat-cache`](./src/chat-cache.ts)             | Prompt-cache snapshots, volatile-token detection, stable/dynamic prompt partitioning, and the shared runtime-context marker.                       |
| [`@localixai/agent/context`](./src/context/index.ts)             | Token estimation, dependency and value scoring, compression planning and application, wire pruning, live-read handling, and compression markers.   |
| [`@localixai/agent/history`](./src/history/index.ts)             | The stage engine a host's history strategy runs, and the stage reports it files.                                                                   |
| [`@localixai/agent/runtime`](./src/runtime/index.ts)             | Ports for credentials and authentication, model references, agent runs, buffered completions, and context policy.                                  |
| [`@localixai/agent/catalog`](./src/catalog/index.ts)             | Provider and model metadata plus media filtering, connection-aware lookup, live-model resolution, and ordering helpers.                            |
| [`@localixai/agent/images/downscale`](./src/images/downscale.ts) | PNG/JPEG long-edge downscaling and a bounded process-local result cache.                                                                           |
| [`@localixai/agent/agents`](./src/agents/index.ts)               | Agent events, tools and tool sets, normalized items, human-in-loop and CLI-agent contracts, error classification, and source metadata.             |
| [`@localixai/agent/agents/chat`](./src/agents/chat.ts)           | Agent-aware chat messages, persisted-history-to-wire conversion, cache anchors, and browser cache snapshots.                                       |
| [`@localixai/agent/agents/items`](./src/agents/items.ts)         | Normalized item and turn types, narrowing guards, lifecycle reducers, append application, and append diffs.                                        |

## Limits

- This package defines runtime ports; it does not select providers, perform provider I/O, or persist
  credentials. Concrete execution is supplied by a runtime adapter at the application composition
  root.
- Asset storage and path access remain host-owned. A host must rehydrate file-backed media and
  materialize spilled or linked context before model-wire conversion.
- Context APIs estimate tokens and choose transformations; they do not manage transcript storage or
  provider prompt caches.
- Image downscaling resizes PNG and JPEG inputs only. Other formats and decode failures pass through
  unchanged.

## Source of truth

- [`package.json`](./package.json) defines the supported import paths.
- [`src/index.ts`](./src/index.ts) and the linked entry modules define their exported contracts.
- [Agent SDK internals](../../docs/internals/sdk.md) describes how application layers compose them.
