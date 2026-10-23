# `@localixai/mini-app-sdk`

Workspace contracts and shared helpers for Localix plugins. Bundled plugin code compiles against
this package; the API and UI hosts implement the capabilities and registries it describes.

This is a private workspace package, not an independently published SDK. Bundled plugins use the
source workspace; user plugins use the plugin kit supplied by Localix, including host-shared UI
modules and generated declarations. Start with
[Build with the agent](../../docs/extending/build-with-the-agent.md) for user-plugin creation and
checks, or [Build plugins](../../docs/extending/mini-apps.md) for registration contracts.

## Consumers

Bundled plugins use the backend, UI, resource, and navigation contracts. The
[API plugin host](../../apps/api/src/features/plugins/native.ts) supplies backend capabilities and
extends the manifest schema, while the [UI host](../../apps/ui/src/shared/contrib/host.ts) adapts UI
contributions to application registries.

## Common workspace entry points

| Entry point                                    | Contract                                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@localixai/mini-app-sdk/backend`              | Server-side `MiniAppContext`, `MiniAppRegistration`, `BackendSubsystem`, typed UI actions and request scope, tools, hooks, channels, providers, host-service ports, and backend helpers. |
| `@localixai/mini-app-sdk/ui`                   | `MiniAppUiHost`, workbench and editor contributions, search and UI-location declarations, message-context drafts, notifications, and host API and bridge-protocol types.                 |
| `@localixai/mini-app-sdk/ui/focus`             | The shared focus stack: which surface owns the keyboard, what classes of global shortcut it tolerates, and the hooks a surface or overlay uses to claim it while it is on screen.        |
| `@localixai/mini-app-sdk/ui/work-item-session` | The host-provided session context of a tab or transcript; null outside a provider or in a global tab.                                                                                    |
| `@localixai/mini-app-sdk/ui/runtime`           | Bound workspace, composer, terminal, external-link, and other UI host ports; imports do not implement their host behavior.                                                               |
| `@localixai/mini-app-sdk/manifest`             | The host-independent manifest schema, API and naming constants, config and file-association schemas, surface normalization, and installability predicates.                               |
| `@localixai/mini-app-sdk/resource-refs`        | Resource-node, provider, browse, and registry contracts plus resource URI and navigation helpers without importing the full backend barrel.                                              |
| `@localixai/mini-app-sdk/navigation`           | Pure builders and strict parsers for canonical `localix://ui/...` and `localix://resource/...` destinations, including files, settings, and capabilities.                                |
| `@localixai/mini-app-sdk/session-resource`     | The address of a resource that exists once per chat (a game board): its bare URI, one chat's URI, and the session a URI names, built on the navigation grammar.                          |

There is no package-root export. Import the narrow entry point that owns the required contract. The
table lists common entry points, not every export. [The manifest](package.json) also lists
transport, interaction, problem-reporting, testing, chart/table, storage, synchronization,
prerequisite, typed-error, UI-artifact, rich-text, and document-layout helpers.

For naming rules, categories, config-type names, API-version constants, and surface helpers, use
`@localixai/mini-app-sdk/manifest-primitives`. This entry point has no schema dependencies; the
`manifest` entry point retains the same exports for compatibility and owns validation schemas.

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
- `bounded-cache`: `createBoundedCache`, the LRU cache bounded by entries and weight that the API
  and the kit re-export.
- `ui/now`: `useNow`, a visibility-gated clock for values derived from a stored timestamp.
- Chat-table games: `createTurnTable` and `seatedAnswer` (`backend`) keep one game per chat and ask
  the agent or the decision model for the turn it owes; `useTableGame` (`ui/game-table`) reads and
  acts on the board's own chat; `sessionGameUi` (`ui/session-game`) registers the board, its
  launcher and its anchor; `opponent` and `agent-wait` carry the opponent's name and wait clock.

See [Plugin synchronization](../../docs/extending/mini-app-sync.md). Draft merging stays with the
resource owner; a cache must expire before an invalidation can produce an authoritative read.

## Limits

- A typed bridge limits the operations its interface exposes; it is not a runtime sandbox for plugin
  code. Native plugin UI imports run in the host document.

- The SDK does not discover, load, authorize, or isolate a plugin. Those responsibilities remain
  with the API and UI hosts.
- `MiniAppContext` capabilities are host-supplied. Optional host services can be absent, and the
  boot-time backend context exposes services that are not present on per-run tool and hook loads.
  Check optional ports before using them; a missing port is not permission to import the host's
  internal implementation.
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
- [Runtime ports](./src/ui/runtime.ts)
- [Tab session context](./src/ui/work-item-session.tsx)
- [Plugin authoring guide](../../docs/extending/mini-apps.md)
