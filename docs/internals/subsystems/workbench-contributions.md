# Workbench contributions

Workbench contributions let an enabled plugin add backend services and workspace UI without adding
domain branches to core composition code. Use this page when creating or changing a bundled
workbench, its registry entries, or its enable and disable lifecycle.

## Terminology

| Term                | Meaning                                                                 | Boundary                                                                       |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Backend subsystem   | One `BackendSubsystem` returned by a plugin's native `register()` call. | It is process-global while the owning plugin is enabled in at least one scope. |
| Backend host        | Reconciler that wires desired plugin subsystems into live registries.   | It keeps an already-wired instance instead of rebuilding it on every refresh.  |
| Host service        | Narrow capability supplied to plugin code through `PluginContext.host`. | Services are optional and do not expose their owning core subsystem directly.  |
| Plugin UI host      | Registration façade passed to a plugin's `registerUi(host)`.            | Plugin code must not import host registry modules.                             |
| Native workbench UI | React contribution built into its own artifact and loaded by URL.       | Bundled plugins, and other plugins once the user enabled them (consent).       |
| Manifest UI         | Sandboxed view described as data in `.localix-app/app.json`.            | Runs in a sandboxed frame, whatever the plugin's origin.                       |

## What you can do

| Operation                      | Mechanism                                                                                  | Boundary                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Mount plugin HTTP routes       | Return `routeMount: { path, app }` from a `BackendSubsystem`.                              | The live dispatcher keeps the first owner of a duplicate path.                                 |
| Add resource and search trees  | Return `resourceProvider` and `searchProvider`.                                            | Registry ownership stays with each provider; disable unregisters by object identity.           |
| Supply model context           | Return validated `contextProviders`.                                                       | Registration does not inject content; a destination-specific consumer must request it.         |
| Add realtime frame families    | Return `wsFrames` with subscribe, unsubscribe, key, frame tag, start, and stop functions.  | Duplicate commands are rejected; same-key subscribers on one socket share a refcounted stream. |
| Supply typed core capabilities | Return known ports through `capabilities`.                                                 | Capability keys are closed and first-owner-wins; absent ports make the consumer degrade.       |
| Clean up domain state          | Return `onShutdown`.                                                                       | Disable calls it before unregistering providers and removing the route mount.                  |
| Add native workspace surfaces  | Register work items, rail entries, anchors, locations, editors, icons, and event handlers. | The bundled plugin module loads only after the API reports that plugin enabled.                |
| Add installed-plugin UI        | Declare `views` in the manifest.                                                           | The host registers removable locations around sandboxed iframe content.                        |

## How it works

### Backend contribution lifecycle

`loadPluginBackends` discovers enabled plugins for the global and project scopes and runs their
native `register()` functions behind the normal trust and failure-isolation gate. The composition
phase keeps the first returned backend group for each plugin name, so one plugin can contribute
several subsystems without being wired again for every enabled scope.

Every plugin loads the same way. There is no manifest declaration that changes how a plugin is
loaded, and no second path that defers the import: the module is imported, and `register()` decides
what the plugin contributes.

### Who pays for a load

A consumer that needs only part of a plugin's contribution takes a narrow loader instead of the full
pipeline, so a boot or a user action does not import and `register()` every enabled plugin to read
one field.

| Consumer               | Loader                                                | Imports plugin code |
| ---------------------- | ----------------------------------------------------- | ------------------- |
| Per-run prompt context | `loadEnabledPlugins`                                  | Yes — needs it all  |
| Plugin backend host    | `loadPluginBackends`                                  | Yes                 |
| Plugin channel host    | `loadEnabledPluginChannels` (`loader-channels.ts`)    | Yes — from register |
| Plugin monitor host    | `loadEnabledPluginMonitors` (`loader-declarative.ts`) | No — manifest data  |

Each load reports its own cost: one `plugins.loaded` line carrying the catalog time, the native time
and the slowest plugins. `apps/api/scripts/startup-budget.ts` reads it out of the runtime log, and
says so explicitly when a boot loads plugins more than once.

`createPluginBackendHost` reconciles the desired plugin names with the currently wired set. Enable
registers subsystem, capability, WebSocket, resource, context, and search contributions before
publishing the route mount. Disable calls `onShutdown`, unregisters identity-checked contributions,
and removes the mount. Reconciles are serialized, and toggle-triggered refreshes are debounced by
300 milliseconds.

Hono route tables cannot remove routes after composition. The backend host therefore mounts one
stable middleware and consults a mutable prefix-to-wrapper map for each request. It resolves the
current user, project, and working directory into the plugin app's `PluginRouteScope`; a plugin
route does not recover that scope from core environment globals.

### Backend contribution fields

| `BackendSubsystem` field | Registry or consumer                      | Invariant and failure boundary                                                     |
| ------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `id`                     | Subsystem and capability ownership        | Keep it stable; disable removes contributions recorded under this source id.       |
| `routeMount`             | Backend-host route dispatcher             | Mount happens last; duplicate paths keep the first wrapper and log a warning.      |
| `resourceProvider`       | Resource-reference registry               | A disabled loser cannot evict a winner because unregister receives the provider.   |
| `searchProvider`         | Global-search provider registry           | Already-wired providers register when the search registry becomes available.       |
| `contextProviders`       | Context Fabric registry                   | Invalid envelopes produce diagnostics instead of crashing reconciliation.          |
| `wsFrames`               | SDK WebSocket frame registry              | Duplicate commands and core's tags `s`, `r`, `n` are rejected and logged.          |
| `capabilities`           | Typed capability registry                 | Only keys declared in `CapabilityShapes` compile; the first enabled provider wins. |
| `onShutdown`             | Backend-host disable and process shutdown | Exceptions are logged; remaining contributions are still unwired.                  |

`PluginHostServices` carries narrow reverse-direction ports: read-only terminal access,
session-owned storage, secret resolution and create-if-free storage, optional secret-reference
binding, wake-only session messages, arming the plugin's own manifest monitors for a session, and
by-id media bytes. The host binds plugin identity and checks user or session ownership. Terminal
listing is limited to the supplied session; sessions, vault values, and media have no enumeration
port.

### UI contribution lifecycle

Core `features/*/contrib` modules register through `discoverUi`. A bundled plugin's React UI is not
host source: it is a built artifact the API advertises on the plugin record and serves, which
[`pluginUiRuntime.ts`](../../../apps/ui/src/shared/contrib/pluginUiRuntime.ts) imports by URL for
the enabled plugins of the current capability snapshot. `pluginUiHostFor` stamps the plugin name
rather than trusting a plugin-supplied owner, and
[`removePluginUiContributions`](../../../apps/ui/src/shared/contrib/host.ts) takes back everything
that owner registered in every registry.

A new artifact revision is imported first and then swapped in (remove the plugin's entries, register
the new ones); a failed import keeps the running version, and a plugin that leaves the enabled set
is unloaded. Each registry still filters lookups through the enabled-plugin set, so restored tabs
and palette entries fail closed until an authoritative snapshot arrives. Manifest panels and views
are data, not native modules. The [workbench UI guide](../../extending/plugin-ui.md) covers the
artifact, the shared modules and the UI kit.

Plugins register after the first paint, so a surface that reads a registry during render has to hear
about a later registration. Every seam of the façade reports one to
[`registryChanges.ts`](../../../apps/ui/src/shared/contrib/registryChanges.ts), and so does each
first-load settle. The registry itself changes at once, but listeners are told on the next frame: N
plugins registering in one burst cost one notification, not N full re-renders. Consumers subscribe
through [`usePluginRegistrySlice`](../../../apps/ui/src/shared/contrib/usePluginRegistrySlice.ts)
with a named slice: one tab kind (`usePluginKind`), one session surface, one slot, one file's
enhancers or one tab strip's kinds. Only a consumer whose own slice moved re-renders.

| `PluginUiHost` registry | Contribution effect                                                        | Boundary                                                                |
| ----------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `workItems`             | Adds editor-grid tab kinds and optional restoration or message binding.    | Duplicate kinds keep the first owner.                                   |
| `railSections`          | Adds a sidebar section and derives an addressable UI location.             | Use for an actual sidebar; it is not a generic workbench launcher.      |
| `railViewlets`          | Adds a launcher for one global work-item surface and derives its location. | The registered work item must exist for activation to succeed.          |
| `search`                | Adds a search scope and result glyph vocabulary.                           | Search metadata does not own activation.                                |
| `anchors`               | Resolves a resource namespace into a semantic navigation target.           | Namespace collisions are rejected.                                      |
| `locations`             | Adds a strict parameterized UI destination.                                | The [UI anchors page](ui-anchors.md) owns URI, effect, and agent rules. |
| `resourceRefIcons`      | Maps resource kind hints to icons.                                         | Icons carry no provider or navigation behavior.                         |
| `fileEditors`           | Selects a specialized editor by file predicate.                            | Runs before file routing; one `preferred` match skips the chooser.      |
| `sessionEvents`         | Handles plugin-specific session stream events.                             | Handlers must be idempotent for each session and event.                 |

### Module invariants and failure modes

| Module                                                                                                                          | Invariant                                                                      | Failure when violated                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`packages/plugin-sdk/src/backend/subsystem.ts`](../../../packages/plugin-sdk/src/backend/subsystem.ts)                         | `BackendSubsystem` is the only plugin-to-core backend contribution shape.      | Adding a parallel composition path makes enable, disable, and shutdown behavior diverge. |
| [`apps/api/src/features/plugins/backend-host.ts`](../../../apps/api/src/features/plugins/backend-host.ts)                       | Wire providers before routes; stop activity before unwiring.                   | A route can serve without dependencies, or live plugin work can outlast disable.         |
| [`apps/api/src/features/plugins/backend-host-ui-actions.ts`](../../../apps/api/src/features/plugins/backend-host-ui-actions.ts) | A UI action resolves in its exact (plugin, project) scope, to one own handler. | A project override answers with the global handler, or a hung handler holds the request. |
| [`apps/api/src/features/ext/capability-registry.ts`](../../../apps/api/src/features/ext/capability-registry.ts)                 | Capability ownership is first-wins and source-checked on removal.              | A disabled loser can otherwise remove or replace the active provider.                    |
| [`packages/plugin-sdk/src/backend/ws-frame-registry.ts`](../../../packages/plugin-sdk/src/backend/ws-frame-registry.ts)         | Command pairs are unique and connection streams are reference-counted.         | Subscribe routing becomes ambiguous or one consumer stops another's stream.              |
| [`apps/ui/src/shared/contrib/host.ts`](../../../apps/ui/src/shared/contrib/host.ts)                                             | Plugins receive one façade and host-stamped ownership.                         | Plugin code can couple to private registries or impersonate another owner.               |
| [`apps/ui/src/shared/contrib/pluginUiRuntime.ts`](../../../apps/ui/src/shared/contrib/pluginUiRuntime.ts)                       | Import a revision before removing the running one; one queue per plugin.       | A broken build blanks a plugin, or racing snapshots leave a stale revision registered.   |
| [`apps/ui/src/shared/contrib/registryChanges.ts`](../../../apps/ui/src/shared/contrib/registryChanges.ts)                       | Every registration is announced, coalesced to one flush per frame.             | A late plugin stays invisible under an open surface, or each plugin re-renders the app.  |
| [`apps/ui/src/shared/contrib/pluginUiLoads.ts`](../../../apps/ui/src/shared/contrib/pluginUiLoads.ts)                           | A failed first load stays pending and is retried; the publisher owns settling. | A transient 503 closes restored tabs, or a failed later request leaves a plugin pending. |
| [`apps/ui/src/app/pluginSharedModules.ts`](../../../apps/ui/src/app/pluginSharedModules.ts)                                     | Artifacts get the host's single React, SDK and kit instances.                  | A second React breaks hooks; a second SDK has unbound transport and empty command maps.  |
| [`apps/ui/src/shared/contrib/enabledPlugins.ts`](../../../apps/ui/src/shared/contrib/enabledPlugins.ts)                         | One capability snapshot drives plugins, tools, and views for the active scope. | UI contributions and model-facing tools can disagree about enablement.                   |

## Configuration

### Example entrypoints

| Plugin    | Backend composition                                                                                                                                    | Native UI composition                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DevOps    | [`mini-apps/devops/backend/index.ts`](../../../mini-apps/devops/backend/index.ts) combines Docker and Kubernetes subsystems and tools.                 | [`mini-apps/devops/ui/register.tsx`](../../../mini-apps/devops/ui/register.tsx) registers provider contributions and one workbench viewlet.            |
| Database  | [`mini-apps/database/backend/index.ts`](../../../mini-apps/database/backend/index.ts) returns route, resource, search, context, cleanup, and tools.    | [`mini-apps/database/ui/register.tsx`](../../../mini-apps/database/ui/register.tsx) registers work items, a viewlet, anchors, icons, and file editors. |
| Documents | [`mini-apps/documents/backend/index.ts`](../../../mini-apps/documents/backend/index.ts) returns document and table subsystems plus typed capabilities. | [`mini-apps/documents/ui/register.tsx`](../../../mini-apps/documents/ui/register.tsx) registers document viewers and editors.                          |

### Activation states

| State or event             | Backend behavior                                                         | UI behavior                                                                   |
| -------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Process start              | First reconciliation runs asynchronously after core composition.         | Core surfaces discover synchronously; plugin surfaces wait for capabilities.  |
| Enabled in any exact scope | One backend group is wired process-wide.                                 | The active project's snapshot enables and imports that plugin's bundled UI.   |
| Plugin toggle              | A 300 ms debounced refresh converges the backend set, then emits change. | The capability snapshot refetch gates registries, views, and tools.           |
| Disable                    | Shutdown runs, providers unregister, and the mutable route mount drops.  | Native definitions remain registered but unavailable; manifest UI is removed. |
| Re-enable                  | A fresh backend instance wires through the same path.                    | The already-imported native module becomes available without re-registering.  |

## Limits

Development watches additions and removals in the kit doors and host-lent module directories with
[`refresh-plugin-shared-modules.ts`](../../../apps/ui/build/refresh-plugin-shared-modules.ts). It
invalidates the shared-module glob and reloads the host page together, so a rebuilt plugin cannot
keep using a registry that predates its imports. Ordinary component edits keep Vite's normal HMR.

- Native workbench UI runs in the host page, so it follows the native-backend trust rule: a bundled
  plugin ships trusted, and any other plugin's artifact is served only after the user enabled it.
  The app builds a user plugin's artifact itself from the plugin kit
  (`apps/api/src/features/plugins/authoring/`).
- Backend enablement is process-global once any exact scope enables the plugin. Route scope is
  resolved per request, but a plugin must not capture one project's working directory at register
  time and treat it as universal.
- Native backend code is trusted in-process code. Registry validation and plugin enablement do not
  provide an operating-system sandbox.
- `BackendSubsystem.routeMount.path` is a conventionally scoped string, not a schema-enforced
  `/rpc/<plugin>` namespace. A collision logs a warning and leaves the later route unavailable.
- Context providers are declarative sources, not automatic prompt injection. Activation, budget,
  timeout, sensitivity, and destination policy belong to
  [Context Fabric](context-and-edit-prediction-architecture.md).
- Core work-item and rail lookups still include built-in fallback maps for surfaces not migrated to
  contribution registries. A new bundled workbench should use the registries instead of extending
  those maps.
- Plugin host services are capability ports, not stable access to core implementation modules. Code
  must handle an optional port being absent.

## Related guides

- [Plugin authoring](../../extending/plugins.md)
- [UI anchors and locations](ui-anchors.md)
- [Global search](global-search.md)
- [Architecture](../architecture.md)

## Source of truth

- [Plugin registration contract](../../../packages/plugin-sdk/src/backend/registration.ts)
- [Backend subsystem contract](../../../packages/plugin-sdk/src/backend/subsystem.ts)
- [Host context and service ports](../../../packages/plugin-sdk/src/backend/context.ts)
- [Backend reconciler](../../../apps/api/src/features/plugins/backend-host.ts)
- [Plugin backend loading](../../../apps/api/src/features/plugins/loader.ts)
- [Channel-only loading](../../../apps/api/src/features/plugins/loader-channels.ts)
- [Manifest-only loading](../../../apps/api/src/features/plugins/loader-declarative.ts)
- [Plugin-host composition](../../../apps/api/src/bootstrap/plugin-hosts.ts)
- [Plugin UI host contract](../../../packages/plugin-sdk/src/ui/host.ts)
- [UI host adapter](../../../apps/ui/src/shared/contrib/host.ts)
- [Plugin UI wiring](../../../apps/ui/src/shared/contrib/pluginUiDiscovery.ts)
- [Plugin UI runtime](../../../apps/ui/src/shared/contrib/pluginUiRuntime.ts)
- [Plugin UI artifact builder](../../../apps/api/src/features/plugins/authoring/ui-build.ts)
- [Plugin kit staging](../../../scripts/stage-plugin-kit.mjs)
- [Development kit cache](../../../scripts/plugin-kit-cache.mjs) (a kit staged for identical inputs
  is reused across `bun run dev` launches)
- [User plugin authoring](../../../apps/api/src/features/plugins/authoring/service.ts)
- [Workbench registries](../../../apps/ui/src/shared/contrib/uiContrib.ts)
