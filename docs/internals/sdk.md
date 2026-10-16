# Agent contracts

`@localixai/agent` defines the framework-neutral contracts shared by Localix runtimes, hosts, and
clients. Use this page when changing an agent boundary or deciding whether code belongs in the
contract package, the Pi adapter, the API host, or the plugin SDK.

## Terminology

| Term             | Meaning                                                               | Boundary                                                     |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Contract package | The workspace-private `@localixai/agent` package.                     | Defines ports and pure helpers; it performs no provider I/O. |
| Runtime adapter  | An implementation of `AgentRuntime` and related ports.                | The production adapter is workspace-private.                 |
| Host             | Application code that supplies policy, storage, tools, and streaming. | The API is the production composition root.                  |
| Plugin SDK       | The supported `@localixai/plugin-sdk` authoring contract.             | Plugin authors should not import application internals.      |

## What you can do

| Need                              | Mechanism                                                      | Boundary                                                            |
| --------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Define a provider-neutral run     | Implement `AgentRuntime.run()` and emit ordered `AgentEvent`s. | The terminal result must settle even when setup or streaming fails. |
| Add an auxiliary model operation  | Depend on the narrower `LanguageModel` port.                   | Titles, summaries, and judges do not start an agent loop.           |
| Share model and provider metadata | Use the catalog DTOs and lookup helpers.                       | Application code does not receive Pi-native model objects.          |
| Apply context policy              | Implement `RuntimeContextPolicy.transform()`.                  | Transcript persistence and recovery remain host responsibilities.   |
| Bridge tools into an engine       | Pass model-visible schemas and local dispatch implementations. | Permissions and plugin lifecycle wrappers run in the host.          |
| Extend Localix from a plugin      | Compile against `@localixai/plugin-sdk/backend` or `/ui`.      | `@localixai/agent` is not a supported external SDK.                 |

## How it works

The dependency direction is one-way:

| Layer                         | Owns                                                                           | Must not own                                   |
| ----------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `@localixai/agent`            | Messages, events, tools, catalogs, context policy, usage, and ports            | Provider clients, database access, or UI state |
| `@localixai/agent-runtime-pi` | Provider conversion, model execution, retries, auth, and event mapping         | Domain persistence, permissions, or product UI |
| API composition root          | Runtime construction, credentials, tools, policy, persistence, and publication | Engine-native wire values outside the adapter  |
| `@localixai/plugin-sdk`       | Plugin context, manifest, backend, navigation, and UI contracts                | Direct access to host-internal modules         |

`AgentRuntime.run()` returns an async event stream and a separate result promise. The adapter
validates the tool registry, maps Localix messages and tools to Pi, applies host callbacks around
tool calls, and maps engine events back to the Localix union.

The Pi adapter buffers up to 256 events before a consumer attaches. Once iteration begins, the
bounded queue applies backpressure; closing the iterator aborts an unfinished run.

The API creates the agent runtime, language-model factory, authentication runtime, and catalog in
`createInfraPhase()`. Feature services receive those ports through composition instead of
constructing provider clients.

## Configuration

### Contract entry points

| Import                              | Contract                                                    |
| ----------------------------------- | ----------------------------------------------------------- |
| `@localixai/agent`                  | Root barrel for shared contracts and pure helpers.          |
| `@localixai/agent/runtime`          | Agent runs, auxiliary completions, and auth ports.          |
| `@localixai/agent/catalog`          | Provider and model metadata plus lookup and ordering.       |
| `@localixai/agent/context`          | Token estimates, checkpoint and VBC plans, and pruning.     |
| `@localixai/agent/agents`           | Tools, events, normalized items, HITL, and CLI-agent types. |
| `@localixai/agent/agents/chat`      | Agent-message conversion and turn snapshots.                |
| `@localixai/agent/agents/items`     | Item reducers, guards, and append diffs.                    |
| `@localixai/agent/images/downscale` | PNG and JPEG long-edge downscaling.                         |

The package also exports narrower `types`, `chat`, and `chat-cache` subpaths. Its
[`package.json`](../../packages/agent/package.json) is the authority for supported imports.

### Workspace commands

| Command                                              | Use                                 | Boundary                                   |
| ---------------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| `bun run --cwd packages/agent type-check`            | Check neutral contract types.       | Does not check the Pi adapter.             |
| `bun test packages/agent/src`                        | Run contract and pure-helper tests. | Uses the repository's Bun test runner.     |
| `bun run --cwd packages/agent-runtime-pi type-check` | Check adapter implementation.       | Does not exercise provider networks.       |
| `bun test packages/agent-runtime-pi/src`             | Run adapter and codec tests.        | Tests use fakes and checked-in registries. |

## Limits

- Both agent packages declare `"private": true`. Do not publish installation instructions or promise
  semver compatibility to external consumers.
- `@localixai/agent` does not select a provider, send a request, persist credentials, or expose a
  product UI. The Pi adapter and API host supply those mechanisms.
- The context package estimates tokens and chooses transformations. It does not own the durable
  transcript, externalized payload storage, or provider prompt cache.
- Image downscaling handles PNG and JPEG input. Unsupported formats and decode failures pass through
  unchanged.
- Credential refresh is durable only when the host supplies a `RuntimeCredentialStore`.
- Plugin authors use the plugin SDK. Native plugins run in the API process when enabled; the SDK is
  a type boundary, not a sandbox.

## Related guides

- [Agent runtime](agent-runtime.md)
- [Context checkpoints](../features/context-checkpoints.md)
- [Providers](../features/providers.md)
- [Create plugins](../extending/plugins.md)

## Source of truth

- [Agent package exports](../../packages/agent/package.json)
- [Runtime contracts](../../packages/agent/src/runtime/index.ts)
- [Tool and event contracts](../../packages/agent/src/agents/types.ts)
- [Context entry point](../../packages/agent/src/context/index.ts)
- [Pi runtime adapter](../../packages/agent-runtime-pi/src/runtime.ts)
- [Pi package exports](../../packages/agent-runtime-pi/package.json)
- [API composition root](../../apps/api/src/bootstrap/infra.ts)
- [Plugin SDK exports](../../packages/plugin-sdk/package.json)
