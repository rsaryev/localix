# `@localixai/plugin-sdk`

Workspace contracts and shared helpers for Localix plugins. Bundled plugin code compiles against
this package; the API and UI hosts implement the capabilities and registries it describes.

The package is not currently published independently because its declarations reference private
Localix agent contracts. The supported authoring surface is the source workspace and bundled
template until that dependency boundary is made publishable.

## Consumers

Bundled plugins use the backend, UI, resource, and navigation contracts. The
[API plugin host](../../apps/api/src/features/plugins/native.ts) supplies backend capabilities and
extends the manifest schema, while the [UI host](../../apps/ui/src/shared/contrib/host.ts) adapts UI
contributions to application registries.

## Workspace entry points

| Entry point                              | Contract                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@localixai/plugin-sdk/backend`          | Server-side `PluginContext`, `PluginRegistration`, `BackendSubsystem`, typed UI actions and request scope, tools, hooks, channels, providers, host-service ports, and backend helpers.       |
| `@localixai/plugin-sdk/ui`               | `PluginUiHost`, workbench and editor contributions, search and UI-location declarations, message-context drafts, notifications, and types for the acquired sandboxed UI API/bridge protocol. |
| `@localixai/plugin-sdk/ui/focus`         | The shared focus stack: which surface owns the keyboard, what classes of global shortcut it tolerates, and the hooks a surface or overlay uses to claim it while it is on screen.            |
| `@localixai/plugin-sdk/manifest`         | The host-independent manifest schema, API and naming constants, config and file-association schemas, surface normalization, and installability predicates.                                   |
| `@localixai/plugin-sdk/resource-refs`    | Resource-node, provider, browse, and registry contracts plus resource URI and navigation helpers without importing the full backend barrel.                                                  |
| `@localixai/plugin-sdk/navigation`       | Pure builders and strict parsers for canonical `localix://ui/...` and `localix://resource/...` destinations, including files, settings, and capabilities.                                    |
| `@localixai/plugin-sdk/session-resource` | The address of a resource that exists once per chat (a game board): its bare URI, one chat's URI, and the session a URI names, built on the navigation grammar.                              |

There is no package-root export. Import the narrow entry point that owns the required contract.

## Synchronization

Use the same source-to-read protocol as core:

- `backend`: `observeMutations` announces successful named service mutations;
  `createStoreChangeFeed` combines commit notifications and host-native filesystem watching.
- `ui/resource-sync`: serialized reads, burst invalidation, stale-answer rejection and bounded
  retries.
- `ui/file-resource-sync`: `useFileResourceSync` for project JSON; a healthy watcher has no poll
  timer.
- `ui/store-resource`: one refcounted store feed across plugins and scopes, with source health.
- `ui/store-snapshot` and `ui/route-snapshot`: validated snapshots and mutation ordering for boards.

See [Plugin synchronization](../../docs/extending/plugin-sync.md). Draft merging stays with the
resource owner; a cache must expire before an invalidation can produce an authoritative read.

## Limits

- The SDK does not discover, load, authorize, or isolate a plugin. Those responsibilities remain
  with the API and UI hosts.
- `PluginContext` capabilities are host-supplied. Optional host services can be absent, and the
  boot-time backend context exposes services that are not present on per-run tool and hook loads.
- The manifest entry point defines the common core only. The API host extends it with the
  contribution kinds it supports.
- Backend utilities are not a browser surface. UI code should use the UI, navigation, or narrowly
  selected resource-reference contracts instead.
- File associations affect operating-system packaging only for bundled plugins; declarations from
  later-installed plugins cannot amend an already-built desktop bundle.

## Source of truth

- [Package exports](./package.json)
- [Backend entry point](./src/backend/index.ts)
- [Registration contract](./src/backend/registration.ts)
- [Backend subsystem contract](./src/backend/subsystem.ts)
- [Host context and services](./src/backend/context.ts)
- [UI entry point](./src/ui/index.ts)
- [Manifest schema](./src/manifest/index.ts)
- [Resource-reference contracts](./src/backend/resource-refs.ts)
- [Navigation grammar](./src/navigation.ts)
- [Per-chat resource address](./src/session-resource.ts)
- [Plugin authoring guide](../../docs/extending/plugins.md)
