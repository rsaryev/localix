# Workbench contributions

Workbench contributions let an enabled mini app add backend services and workspace UI without adding
domain branches to core composition code. Use this page when creating or changing a mini app
workbench, its registry entries, or its enable and disable lifecycle.

## Terminology

| Term                | Meaning                                                                                                                            | Boundary                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Backend subsystem   | One `BackendSubsystem` returned by a mini app's native `register()` call.                                                          | It is process-global while the owning mini app is enabled in at least one scope. |
| Backend host        | Reconciler that wires desired mini app subsystems into live registries.                                                            | It keeps an already-wired instance instead of rebuilding it on every refresh.    |
| Host service        | Narrow capability supplied to mini app code through `MiniAppContext.host`.                                                         | Services are optional and do not expose their owning core subsystem directly.    |
| Mini app UI host    | Registration façade passed to a mini app's `registerUi(host)`; `disposeUi()` runs first when the mini app is replaced or disabled. | Mini app code must not import host registry modules.                             |
| Native workbench UI | React contribution built into its own artifact and loaded by URL.                                                                  | Mini apps once the user enabled them (consent).                                  |
| Manifest UI         | Sandboxed view described as data in the mini app manifest.                                                                         | Runs in a sandboxed frame, whatever the mini app's origin.                       |

## What you can do

| Operation                      | Mechanism                                                                                  | Boundary                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Mount mini app HTTP routes     | Return `routeMount: { path, app }` from a `BackendSubsystem`.                              | The live dispatcher keeps the first owner of a duplicate path.                                 |
| Add resource and search trees  | Return `resourceProvider` and `searchProvider`.                                            | Registry ownership stays with each provider; disable unregisters by object identity.           |
| Supply model context           | Return validated `contextProviders`.                                                       | Registration does not inject content; a destination-specific consumer must request it.         |
| Add realtime frame families    | Return `wsFrames` with subscribe, unsubscribe, key, frame tag, start, and stop functions.  | Duplicate commands are rejected; same-key subscribers on one socket share a refcounted stream. |
| Supply typed core capabilities | Return known ports through `capabilities`.                                                 | Capability keys are closed and first-owner-wins; absent ports make the consumer degrade.       |
| Clean up domain state          | Return `onShutdown`.                                                                       | Disable calls it before unregistering providers and removing the route mount.                  |
| Add native workspace surfaces  | Register work items, rail entries, anchors, locations, editors, icons, and event handlers. | The mini app module loads only after the API reports that mini app enabled.                    |
| Add installed mini app UI      | Declare `views` in the manifest.                                                           | The host registers removable locations around sandboxed iframe content.                        |

## How it works

### Backend contribution lifecycle

`loadMiniAppBackends` discovers enabled mini apps for the global and project scopes and runs their
native `register()` functions behind the normal trust and failure-isolation gate. The composition
phase keeps the first returned backend group for each mini app name, so one mini app can contribute
several subsystems without being wired again for every enabled scope.

Every mini app loads the same way. There is no manifest declaration that changes how a mini app is
loaded, and no second path that defers the import: the module is imported, and `register()` decides
what the mini app contributes.

### Who pays for a load

A consumer that needs only part of a mini app's contribution takes a narrow loader instead of the
full pipeline, so a boot or a user action does not import and `register()` every enabled mini app to
read one field.

| Consumer               | Loader                                              | Imports mini app code |
| ---------------------- | --------------------------------------------------- | --------------------- |
| Per-run prompt context | `loadEnabledMiniApps`                               | Yes — needs it all    |
| Mini app backend host  | `loadMiniAppBackends`                               | Yes                   |
| Mini app channel host  | `loadEnabledMiniAppChannels` (`loader-channels.ts`) | Yes — from register   |

Each load reports its own cost: one `mini_apps.loaded` line carrying the catalog time, the native
time and the slowest mini apps. `apps/api/scripts/startup-budget.ts` reads it out of the runtime
log, and says so explicitly when a boot loads mini apps more than once.

`createMiniAppBackendHost` reconciles the desired mini app names with the currently wired set.
Enable registers subsystem, capability, WebSocket, resource, context, and search contributions
before publishing the route mount. Disable calls `onShutdown`, unregisters identity-checked
contributions, and removes the mount. Reconciles are serialized, and toggle-triggered refreshes are
debounced by 300 milliseconds.

Hono route tables cannot remove routes after composition. The backend host therefore mounts one
stable middleware and consults a mutable prefix-to-wrapper map for each request. It resolves the
current user, project, and working directory into the mini app's `MiniAppRouteScope`; a mini app
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

`MiniAppHostServices` carries narrow reverse-direction ports: read-only terminal access,
session-owned storage, secret resolution and create-if-free storage, optional secret-reference
binding, wake-only session messages, and by-id media bytes. The host binds mini app identity and
checks user or session ownership. Terminal listing is limited to the supplied session; sessions,
vault values, and media have no enumeration port.

### UI contribution lifecycle

Core `features/*/contrib` modules register through `discoverUi`. A mini app's React UI is not host
source: it is a built artifact the API advertises on the mini app record and serves, which
[`miniAppUiRuntime.ts`](../../../apps/ui/src/shared/contrib/miniAppUiRuntime.ts) imports by URL for
the enabled mini apps of the current capability snapshot. `miniAppUiHostFor` stamps the mini app
name rather than trusting an owner the mini app supplies, and
[`removeMiniAppUiContributions`](../../../apps/ui/src/shared/contrib/host.ts) takes back everything
that owner registered in every registry.

A new artifact revision is imported first and then swapped in (remove the mini app's entries,
register the new ones); a failed import keeps the running version, and a mini app that leaves the
enabled set is unloaded. Each registry still filters lookups through the enabled mini app set, so
restored tabs and palette entries fail closed until an authoritative snapshot arrives. Manifest
panels and views are data, not native modules. The
[workbench UI guide](../../extending/mini-app-ui.md) covers the artifact, the shared modules and the
UI kit.

Mini apps register after the first paint, so a surface that reads a registry during render has to
hear about a later registration. Every seam of the façade reports one to
[`registryChanges.ts`](../../../apps/ui/src/shared/contrib/registryChanges.ts), and so does each
first-load settle. The registry itself changes at once, but listeners are told on the next frame: N
mini apps registering in one burst cost one notification, not N full re-renders. Consumers subscribe
through [`useMiniAppRegistrySlice`](../../../apps/ui/src/shared/contrib/useMiniAppRegistrySlice.ts)
with a named slice: one tab kind (`useMiniAppKind`), one session surface, one slot, one file's
enhancers or one tab strip's kinds. Only a consumer whose own slice moved re-renders.

| `MiniAppUiHost` registry | Contribution effect                                                        | Boundary                                                                |
| ------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `workItems`              | Adds editor-grid tab kinds and optional restoration or message binding.    | Duplicate kinds keep the first owner.                                   |
| `railSections`           | Adds a sidebar section and derives an addressable UI location.             | Use for an actual sidebar; it is not a generic workbench launcher.      |
| `railViewlets`           | Adds a launcher for one global work-item surface and derives its location. | The registered work item must exist for activation to succeed.          |
| `search`                 | Adds a search scope and result glyph vocabulary.                           | Search metadata does not own activation.                                |
| `anchors`                | Resolves a resource namespace into a semantic navigation target.           | Namespace collisions are rejected.                                      |
| `locations`              | Adds a strict parameterized UI destination.                                | The [UI anchors page](ui-anchors.md) owns URI, effect, and agent rules. |
| `resourceRefIcons`       | Maps resource kind hints to icons.                                         | Icons carry no provider or navigation behavior.                         |
| `fileEditors`            | Selects a specialized editor by file predicate.                            | Runs before file routing; one `preferred` match skips the chooser.      |
| `sessionEvents`          | Handles a mini app's own session stream events.                            | Handlers must be idempotent for each session and event.                 |

### Module invariants and failure modes

| Module                                                                                                                              | Invariant                                                                        | Failure when violated                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`packages/mini-app-sdk/src/backend/subsystem.ts`](../../../packages/mini-app-sdk/src/backend/subsystem.ts)                         | `BackendSubsystem` is the only mini app-to-core backend contribution shape.      | Adding a parallel composition path makes enable, disable, and shutdown behavior diverge.    |
| [`apps/api/src/features/mini-apps/backend-host.ts`](../../../apps/api/src/features/mini-apps/backend-host.ts)                       | Wire providers before routes; stop activity before unwiring.                     | A route can serve without dependencies, or live mini app work can outlast disable.          |
| [`apps/api/src/features/mini-apps/backend-host-ui-actions.ts`](../../../apps/api/src/features/mini-apps/backend-host-ui-actions.ts) | A UI action resolves in its exact (mini app, project) scope, to one own handler. | A project override answers with the global handler, or a hung handler holds the request.    |
| [`apps/api/src/features/ext/capability-registry.ts`](../../../apps/api/src/features/ext/capability-registry.ts)                     | Capability ownership is first-wins and source-checked on removal.                | A disabled loser can otherwise remove or replace the active provider.                       |
| [`packages/mini-app-sdk/src/backend/ws-frame-registry.ts`](../../../packages/mini-app-sdk/src/backend/ws-frame-registry.ts)         | Command pairs are unique and connection streams are reference-counted.           | Subscribe routing becomes ambiguous or one consumer stops another's stream.                 |
| [`apps/ui/src/shared/contrib/host.ts`](../../../apps/ui/src/shared/contrib/host.ts)                                                 | Mini apps receive one façade and host-stamped ownership.                         | Mini app code can couple to private registries or impersonate another owner.                |
| [`apps/ui/src/shared/contrib/miniAppUiRuntime.ts`](../../../apps/ui/src/shared/contrib/miniAppUiRuntime.ts)                         | Import a revision before removing the running one; one queue per mini app.       | A broken build blanks a mini app, or racing snapshots leave a stale revision registered.    |
| [`apps/ui/src/shared/contrib/registryChanges.ts`](../../../apps/ui/src/shared/contrib/registryChanges.ts)                           | Every registration is announced, coalesced to one flush per frame.               | A late mini app stays invisible under an open surface, or each mini app re-renders the app. |
| [`apps/ui/src/shared/contrib/miniAppUiLoads.ts`](../../../apps/ui/src/shared/contrib/miniAppUiLoads.ts)                             | A failed first load stays pending and is retried; the publisher owns settling.   | A transient 503 closes restored tabs, or a failed later request leaves a mini app pending.  |
| [`apps/ui/src/app/miniAppSharedModules.ts`](../../../apps/ui/src/app/miniAppSharedModules.ts)                                       | Artifacts get the host's single React, SDK and kit instances.                    | A second React breaks hooks; a second SDK has unbound transport and empty command maps.     |
| [`apps/ui/src/shared/contrib/enabledMiniApps.ts`](../../../apps/ui/src/shared/contrib/enabledMiniApps.ts)                           | One capability snapshot drives mini apps, tools, and views for the active scope. | UI contributions and model-facing tools can disagree about enablement.                      |

## Configuration

### Example entrypoints

The core holds no workbench. The workbench mini apps of the
[Localix marketplace](https://github.com/rsaryev/localix-marketplace/tree/main/mini-apps) are
written against this contract: each has a `backend/index.ts` returning its subsystems and tools, and
a `ui/register.tsx` registering its work items, viewlet, anchors, icons and editors.

### Activation states

| State or event             | Backend behavior                                                         | UI behavior                                                                    |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Process start              | First reconciliation runs asynchronously after core composition.         | Core surfaces discover synchronously; mini app surfaces wait for capabilities. |
| Enabled in any exact scope | One backend group is wired process-wide.                                 | The active project's snapshot enables and imports that mini app's built UI.    |
| Mini app toggle            | A 300 ms debounced refresh converges the backend set, then emits change. | The capability snapshot refetch gates registries, views, and tools.            |
| Disable                    | Shutdown runs, providers unregister, and the mutable route mount drops.  | Native definitions remain registered but unavailable; manifest UI is removed.  |
| Re-enable                  | A fresh backend instance wires through the same path.                    | The already-imported native module becomes available without re-registering.   |

## Limits

Development watches additions and removals in the kit doors and host-lent module directories with
[`refresh-mini-app-shared-modules.ts`](../../../apps/ui/build/refresh-mini-app-shared-modules.ts).
It invalidates the shared-module glob and reloads the host page together, so a rebuilt mini app
cannot keep using a registry that predates its imports. Ordinary component edits keep Vite's normal
HMR.

- Native workbench UI runs in the host page, so it follows the native-backend trust rule: a mini
  app's artifact is served only after the user enabled it. The artifact is built from the mini app
  kit by the authoring plugin of the Localix marketplace, and Localix installs the built package.
- Backend enablement is process-global once any exact scope enables the mini app. Route scope is
  resolved per request, but a mini app must not capture one project's working directory at register
  time and treat it as universal.
- Native backend code is trusted in-process code. Registry validation and mini app enablement do not
  provide an operating-system sandbox.
- `BackendSubsystem.routeMount.path` is a conventionally scoped string, not a schema-enforced
  `/rpc/<mini-app>` namespace. A collision logs a warning and leaves the later route unavailable.
- Context providers are declarative sources, not automatic prompt injection. Activation, budget,
  timeout, sensitivity, and destination policy belong to
  [Context Fabric](context-and-edit-prediction-architecture.md).
- Core work-item and rail lookups still include built-in fallback maps for surfaces not migrated to
  contribution registries. A new workbench should use the registries instead of extending those
  maps.
- Mini app host services are capability ports, not stable access to core implementation modules.
  Code must handle an optional port being absent.

## Related guides

- [Build a mini app](../../extending/mini-apps.md)
- [UI anchors and locations](ui-anchors.md)
- [Global search](global-search.md)
- [Architecture](../architecture.md)

## Source of truth

- [Mini app registration contract](../../../packages/mini-app-sdk/src/backend/registration.ts)
- [Backend subsystem contract](../../../packages/mini-app-sdk/src/backend/subsystem.ts)
- [Host context and service ports](../../../packages/mini-app-sdk/src/backend/context.ts)
- [Backend reconciler](../../../apps/api/src/features/mini-apps/backend-host.ts)
- [Mini app backend loading](../../../apps/api/src/features/mini-apps/loader.ts)
- [Channel-only loading](../../../apps/api/src/features/mini-apps/loader-channels.ts)
- [Mini app host composition](../../../apps/api/src/bootstrap/mini-app-hosts.ts)
- [Mini app UI host contract](../../../packages/mini-app-sdk/src/ui/host.ts)
- [UI host adapter](../../../apps/ui/src/shared/contrib/host.ts)
- [Mini app UI wiring](../../../apps/ui/src/shared/contrib/miniAppUiDiscovery.ts)
- [Mini app UI runtime](../../../apps/ui/src/shared/contrib/miniAppUiRuntime.ts)
- [Mini app UI artifact builder](https://github.com/rsaryev/localix-marketplace/tree/main/plugins)
  (in the authoring plugin)
- [Mini app kit staging](../../../scripts/stage-mini-app-kit.mjs)
- [Development kit cache](../../../scripts/mini-app-kit-cache.mjs) (a kit staged for identical
  inputs is reused across `bun run dev` launches)
- [User mini app authoring](https://github.com/rsaryev/localix-marketplace/tree/main/plugins) and
  [the local install](../../../apps/api/src/features/mini-apps/local-install.ts)
- [Workbench registries](../../../apps/ui/src/shared/contrib/uiContrib.ts)
