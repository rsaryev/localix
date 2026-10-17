# Architecture

Localix runs a React workspace against a local Bun API, with a Tauri shell packaging both for
desktop use. Use this map to find the owner of a UI surface, runtime behavior, transport, or stored
record before changing it.

## Terminology

| Term                            | Meaning                                                                                                                  | Boundary                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Agentic Development Environment | The product category covering connected development surfaces, context, model routes, agents, and extensible workbenches. | Do not use it to exclude non-code workbenches.               |
| Session                         | The durable unit of direct or orchestrated agent work.                                                                   | A session can contain multiple runs.                         |
| Worker                          | A session created for delegated work.                                                                                    | It is not automatically isolated.                            |
| Kanban board                    | The bundled `kanban` plugin's per-chat task board, with dependencies and a card lifecycle.                               | A plugin, not core; not a general project-management system. |
| Workbench                       | A plugin-contributed product surface.                                                                                    | It exists only while its plugin is enabled.                  |
| Work item                       | A typed editor-grid pane.                                                                                                | Each registered kind owns its component and state contract.  |
| Composition root                | Bootstrap code selecting concrete infrastructure.                                                                        | Feature modules receive those dependencies.                  |

## Ownership contract

| Path                        | Owns                                                                          | Boundary                                                              |
| --------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/api`                  | Hono routes, domain services, agent execution, persistence, and plugin hosts. | Feature code reaches the agent loop through the runtime port.         |
| `apps/ui`                   | React workspaces, typed panes, settings, and API/event clients.               | It requests state from the API; it does not own durable domain state. |
| `apps/desktop-tauri`        | Native window, release sidecar lifecycle, and desktop capabilities.           | Development scripts start the API instead of the Rust shell.          |
| `apps/landing`              | Documentation site and generated navigation.                                  | It is not part of the desktop runtime.                                |
| `packages/agent`            | Provider-neutral agent types, tools, messages, and runtime interfaces.        | It cannot import Localix API features or the Pi adapter.              |
| `packages/agent-runtime-pi` | Production adapter from the runtime port to Pi.                               | Production API imports are limited to the bootstrap composition root. |
| `packages/plugin-sdk`       | Plugin manifests and host contribution contracts.                             | A contribution exists only when its plugin is installed and enabled.  |
| `packages/cli`              | The `localix` launcher: it hands a path to the running desktop app.           | It opens a deep link; it never starts a runtime or renders a session. |
| `plugins`                   | Bundled tool, provider, hook, workbench, and UI contributions.                | Each manifest declares its own capabilities and default state.        |

## How it works

### Release startup

```text
Tauri shell
  -> reserve a loopback port
  -> spawn the bundled Bun sidecar
  -> wait for LOCALIX_RUNTIME_READY
  -> release the UI runtime-ready barrier
  -> connect API clients
```

The desktop release waits for the sidecar readiness signal before the UI opens its core event
connection. In development, the Tauri code does not spawn that sidecar; workspace scripts own the
API process, and a development build of the UI holds its first reads on the same barrier by polling
the API's own `/health` (`apps/ui/src/shared/lib/runtimeReady.ts`) instead of failing into the
startup retry ladder.

The first capability snapshot names every enabled plugin's tools. Answering that means running each
plugin's `register()`, so the answer is kept on disk under `~/.localix/cache` and a launch whose
plugin code, config and host build are unchanged serves it without importing any backend
(`apps/api/src/features/plugins/inspection-store.ts`). The UI publishes the enabled set and tools
the moment that snapshot lands and registers each plugin's UI as its own artifact loads.

### API composition

`apps/api/src/bootstrap.ts` is the composition root. Its phases create infrastructure, registries,
plugin hosts, domain services, the chat service, the trigger engine, the application facade, routes,
and background timers. Features receive those dependencies rather than constructing storage or the
agent adapter themselves.

SQLite stores projects, sessions, messages, task state, provider connections, and other local
records through Kysely repositories. Production stores media bytes in a filesystem directory next to
the configured database file.

### Client transport

| Channel           | Mechanism                                                                      | Boundary                                                                    |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| HTTP/RPC          | Request-response operations use shared API types, checked at build time.       | Route availability depends on the running API and enabled hosts.            |
| Core event socket | One retained `/rpc/ws` connection multiplexes subscriptions and WebSocket RPC. | It is the shared application channel, not the transport for terminal bytes. |
| Terminal stream   | Each terminal pane opens a dedicated WebSocket for its PTY session.            | The pane closes that socket when its stream lifecycle ends.                 |

The editor grid maps typed `WorkItem` records to pane components. Core panes are registered in the
UI registry; enabled plugins can contribute additional pane types through the plugin host.

#### A value crossing into the browser needs its own leaf

`@localixai/api/client` is a TYPE-ONLY barrel. Types erase, so importing one costs the web bundle
nothing; a VALUE import loads the module it lives in and everything that module imports. Because the
barrel re-exports from the API's own contracts, one value export there can reach the chat contracts,
the plugin-sdk backend, and through them `node:path` / `node:dns`. Vite does not fail on that — it
externalizes the builtin and hands the browser a stub that throws on first use
(`Module "node:dns" has been externalized for browser compatibility`).

So a constant, schema, or helper the UI needs at RUNTIME gets a narrow subpath in
`apps/api/package.json` (`./tool-names`, `./slash-catalog`, `./tip-contracts`, `./session-ref`, …),
pointing at a module with few or no imports — never a re-export from `client.ts`.

`scripts/browser-graph-guard.test.ts` enforces it by walking the module graph of everything the web
build pulls in — the HTML entry plus each `import.meta.glob` (feature contributions, UI surfaces)
and every bundled plugin's UI artifact entry — and failing on any `node:` import, with the chain
that reached it.

### Agent execution

The chat service assembles session context, effective configuration, tools, permissions, and
persistence around the `AgentRuntime` port. The production composition root supplies the Pi adapter.
The
[agent runtime boundary](https://github.com/rsaryev/localix/blob/main/docs/internals/agent-runtime.md)
owns that interface and its event contract.

Kanban is a bundled plugin
([`plugin.json`](https://github.com/rsaryev/localix/blob/main/plugins/kanban/plugin.json)): a
passive board per chat, stored in that chat's plugin folder. Core names no board. The plugin reaches
the host only through generic seams — per-chat storage, the agent directory, the tool's bound
speaker, a resource and a search provider, and a live-frame stream. It creates no session and starts
no run; agents create child sessions only with the `delegate` tool. The
[Kanban guide](../features/task-board.md) owns the board's lifecycle.

## Configuration

Architecture checks are repository commands, not runtime settings.

| Command                               | Checks                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `bun run check:architecture`          | Package import boundaries and the production Pi composition-root rule.     |
| `bun run check:docs`                  | Internal subsystem references documented by the architecture checker.      |
| `bun run --cwd apps/landing docs:gen` | Documentation metadata, links, repository paths, and generated navigation. |

Plugin enablement changes which tools, providers, hooks, and workbench panes the hosts register. The
[plugin architecture](../extending/plugins.md) owns manifest fields and contribution lifecycles.

## Limits

- The release desktop starts a local sidecar. SSH and Docker execution adapters exist as groundwork,
  but the session environment selector is not wired.
- The core event socket is multiplexed, while terminal panes use separate stream sockets. Treating
  all live traffic as one connection is incorrect.
- SQLite and filesystem stores are local process dependencies. This layout is not a distributed
  control plane or multi-node persistence design.
- The architecture checker validates import text and known package rules. It does not prove runtime
  behavior or dependency injection correctness.
- Plugin surfaces are conditional. A bundled plugin can be disabled, and an installed plugin can
  omit a contribution type.
- Tauri release startup and development startup deliberately differ. A failure reproduced in one
  path may not exercise the other.

## Related guides

- [Agent runtime boundary](https://github.com/rsaryev/localix/blob/main/docs/internals/agent-runtime.md)
- [Environment and configuration](environment.md)
- [Workspace](../features/workspace.md)
- [Execution environments](../features/execution-environments.md)
- [Plugins](../extending/plugins.md)

## Source of truth

- [API composition root](https://github.com/rsaryev/localix/blob/main/apps/api/src/bootstrap.ts)
- [Desktop sidecar lifecycle](https://github.com/rsaryev/localix/blob/main/apps/desktop-tauri/src-tauri/src/sidecar.rs)
- [Core event socket](https://github.com/rsaryev/localix/blob/main/apps/ui/src/shared/api/eventSocket.ts)
- [Terminal stream pane](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/terminal/ui/TerminalPane.tsx)
- [Work-item registry](https://github.com/rsaryev/localix/blob/main/apps/ui/src/widgets/editor-grid/ui/registry.tsx)
- [Runtime interfaces](https://github.com/rsaryev/localix/blob/main/packages/agent/src/runtime/index.ts)
- [Plugin manifest contracts](https://github.com/rsaryev/localix/blob/main/packages/plugin-sdk/src/manifest/index.ts)
- [Architecture checker](https://github.com/rsaryev/localix/blob/main/scripts/check-architecture.mjs)
- [Browser-graph guard](https://github.com/rsaryev/localix/blob/main/scripts/browser-graph-guard.test.ts)
- [API export map (the leaves)](https://github.com/rsaryev/localix/blob/main/apps/api/package.json)
