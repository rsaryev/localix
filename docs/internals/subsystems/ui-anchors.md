# UI anchors and locations

UI anchors and locations translate canonical Localix URIs into semantic workbench navigation
targets. Use this page when making a resource, component, plugin view, command, or agent suggestion
open through the shared navigation path.

## Terminology

| Term                 | Meaning                                                                 | Boundary                                                                     |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Addressable resource | Stable identity and presentation stored in an `AddressableResource`.    | Identity does not grant expand, bind, or open capability.                    |
| UI anchor            | Namespace-owned resolver for resource URIs and optional child browsing. | One contribution exclusively owns each registered namespace.                 |
| UI location          | Exact base URI with a typed query schema and semantic resolver.         | The location accepts no query key outside its declared schema.               |
| Contextual surface   | Catalogued component boundary without an independent URI.               | It cannot be published to search, the palette, or an agent.                  |
| Navigation target    | Host-neutral result such as `work-item`, `settings`, or `file`.         | Only the host adapter performs the concrete UI effect.                       |
| Workbench catalog    | Immutable set of agent-published read locations for one run.            | It is scoped to one user and project and contains no callbacks or live data. |

## What you can do

| Operation                    | Mechanism                                                                                 | Boundary                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Give a resource one identity | Reuse its canonical `localix://resource/...` URI across search, bindings, and navigation. | Store current state outside the URI; load it when the destination opens.                       |
| Open a provider resource     | Register a `UiAnchorContribution` for the provider namespace.                             | Duplicate contribution ids or namespaces are rejected atomically.                              |
| Address a component directly | Declare a `UiLocationContribution` with `defineUiLocation`.                               | Registration requires an effect, surface kind, exposure policy, and valid query schema.        |
| Address a trusted mutation   | Declare `localix://ui/action/<owner>/<name>` with `defineUiMutation`.                     | Resolution requires a user-driven caller to pass `allowWrite`; agent output cannot supply it.  |
| Catalogue a nested component | Declare it with `defineContextualUiSurface`.                                              | Use this when the component has no safe standalone identity or cannot reconstruct its payload. |
| Offer UI from an agent tool  | Return `ui.navigate` (`ctx.ui.offer` in a plugin) or bounded `ui.navigate.suggestions`.   | Serialized destinations are read-only; the frontend revalidates availability before opening.   |

## How it works

### URI resolution

`parseLocalixUri` accepts canonical `localix://resource/...` and `localix://ui/...` identities. UI
locations use the first path segment after `ui` as their surface kind, for example
`localix://ui/work-item/file`; resource anchors dispatch by the first resource breadcrumb.

`resolveUiNavigationDetail` applies one deterministic order:

1. Resolve an exact UI location and validate its query.
2. Stop if that location owns the base URI but the request is malformed, disabled, or denied.
3. Resolve the URI through its resource-anchor namespace owner.
4. Parse the always-present Settings and command forms.

Resolution returns a semantic target. `useUiNavigation` maps that target to routing, inspector,
sidebar, Settings, command, model-picker, overlay, file, or work-item behavior. `invokeUi` is the
shared activation point and requests an optional element reveal after the host opens the target.

### Discovery and plugin activation

`discoverUi` eagerly imports core `features/*/contrib` modules and `*.surface` declarations once. A
malformed or colliding discovered surface throws, because silently omitting a static declaration
would make the source catalogue differ from the running workbench.

Bundled plugin UI follows the API's enabled-plugin snapshot. `discoverEnabledPluginUi` imports an
enabled plugin's `ui/register.tsx` once, and `pluginUiHostFor` stamps the plugin name on every
contribution. Registries retain the definition after disable, but lookups and lists filter it out.
Installed plugin views register from manifest data and can be removed during live reconciliation;
their HTML runs through the separate iframe bridge described by the
[plugin guide](../../extending/plugins.md#ui-paths).

### Agent catalogue and serialized output

The frontend publishes only always-available, read-only locations with explicit agent metadata. The
backend normalizes the complete snapshot, derives a `ui1_...` content id, and stores the immutable
catalogue under the authenticated user and project. A run carries that id in the `workbench-ui` tool
surface, so later registry changes do not alter its destination set.

At render time, `viewUiNavigationAction` resolves availability and owner-provided copy together. The
live owner wins over serialized fallback text. A disabled or stale destination remains a disabled
button; it never becomes a chat message or a model-blocking interaction.

### Module invariants and failure modes

| Module                                                                                                                | Invariant                                                                              | Failure when violated                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`packages/plugin-sdk/src/navigation.ts`](../../../packages/plugin-sdk/src/navigation.ts)                             | One strict parser and builder own Localix URI grammar.                                 | Alternate spellings can address different targets or bypass registry ownership.                                |
| [`packages/plugin-sdk/src/ui/locations.ts`](../../../packages/plugin-sdk/src/ui/locations.ts)                         | Construction and resolution share one bounded query schema.                            | Unknown, duplicate, missing, malformed, or oversized arguments fail closed.                                    |
| [`apps/ui/src/shared/contrib/uiLocations.ts`](../../../apps/ui/src/shared/contrib/uiLocations.ts)                     | Location id and base URI are first-owner-wins; batches commit atomically.              | One rejected batch restores every prior entry and logs why the catalogue stayed unchanged.                     |
| [`apps/ui/src/shared/contrib/uiAnchors.ts`](../../../apps/ui/src/shared/contrib/uiAnchors.ts)                         | One enabled contribution owns each anchor namespace.                                   | A duplicate owner is rejected instead of shadowing the current resolver.                                       |
| [`apps/ui/src/shared/contrib/uiSurfaceDiscovery.ts`](../../../apps/ui/src/shared/contrib/uiSurfaceDiscovery.ts)       | Every discovered module default-exports one valid, uniquely identified declaration.    | Discovery throws during startup or tests rather than dropping a surface.                                       |
| [`apps/ui/src/shared/lib/uiNavigation.ts`](../../../apps/ui/src/shared/lib/uiNavigation.ts)                           | All consumers resolve before the host performs an effect.                              | Malformed, stale, disabled, or effect-mismatched URIs become explicit no-ops.                                  |
| [`apps/ui/src/shared/contrib/uiLocationCatalogSync.ts`](../../../apps/ui/src/shared/contrib/uiLocationCatalogSync.ts) | A run binds only to a complete catalogue for its current project scope.                | A changed registry invalidates the old id; sending waits up to 1.5 seconds, then proceeds without a catalogue. |
| [`apps/api/src/features/ui-locations/service.ts`](../../../apps/api/src/features/ui-locations/service.ts)             | Catalogue identity depends on normalized content, while revision orders one publisher. | Same-revision conflicts are rejected; stale revisions cannot replace a retained newer snapshot.                |

## Configuration

### URI and query limits

| Contract               | Value or accepted form                                             | Boundary                                                                  |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| URI length             | 4,096 characters                                                   | Credentials, fragments, dot segments, and noncanonical paths are refused. |
| URI breadcrumbs        | 1–16 resource segments; at least 2 UI segments                     | Each decoded segment is non-empty and at most 512 characters.             |
| Location query entries | At most 16                                                         | Duplicate scalar keys and unknown keys are refused.                       |
| `string`               | Default maximum 512 characters; optional fixed values              | Empty strings require `allowEmpty`; fixed-value lists contain at most 32. |
| `boolean`              | `true` or `false`                                                  | Other spellings are refused.                                              |
| `integer`              | Safe base-10 integer with optional minimum and maximum             | Leading-zero aliases and unsafe integers are refused.                     |
| `string-array`         | Repeated query key; default maximum 8 items of 512 characters each | Empty items are refused; declared limits cannot exceed the global caps.   |
| Agent catalogue        | At most 128 normalized locations                                   | Every agent-visible parameter requires a model-facing description.        |
| Location group         | Optional, trimmed, at most 80 characters                           | Copied from the contribution's `group`; a weak ranking signal only.       |

### Navigation output

| Output                      | Activation                                                              | Boundary                                                                                 |
| --------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ui.navigate`               | Renders one manual button.                                              | URI must be read-only and label/description lengths are validated.                       |
| `ui.navigate.suggestions`   | Renders 1–10 duplicate-free buttons in a horizontal strip.              | Returning the payload does not open anything.                                            |
| `localix://` link in text   | An agent's Markdown link to a read-only view opens it on click.         | Action links stay inert; a view whose owner is not registered renders as text.           |
| `localix://ui/command/<id>` | Invokes a registered read command.                                      | The live command must still declare `effect: 'read'`.                                    |
| `localix://ui/action/...`   | Invokes a trusted write location or `localix://ui/action/command/<id>`. | The caller must pass `allowWrite`; the URI namespace must match the live command effect. |

## Limits

- `AddressableResource` is identity and presentation only. Resource providers own backend expansion,
  message bindings own chat attachment, and anchors or locations own navigation.
- The frontend location registry is process-local. A restart rebuilds it from core declarations,
  enabled bundled plugin code, and the current manifest-derived views.
- Backend catalogues are memory-only and globally bounded to 256 retained snapshots. An evicted id
  yields no agent destinations for that run.
- Runtime-only locations stay out of backend catalogues. The agent has no catalogue-search tool: it
  links a destination by writing its exact `localix://` URI, which the workbench renders as a button
  and revalidates before opening.
- UI URIs carry selectors and safe prefills, not authority. Opening a terminal profile may create a
  pane, but an ordinary navigation URI cannot execute a prefilled command.
- The desktop deep-link forms `localix://session`, `project`, `new`, and `open` use a separate OS
  transport parser. Internal `localix://ui` and `localix://resource` URIs do not route through it.

## Related guides

- [Global search](global-search.md)
- [Workbench contributions](workbench-contributions.md)
- [Plugin authoring](../../extending/plugins.md)
- [Workspace](../../features/workspace.md)

## Source of truth

- [Resource identity](../../../packages/plugin-sdk/src/resource.ts)
- [Anchor and navigation output contracts](../../../packages/plugin-sdk/src/ui/anchors.ts)
- [Location schemas and catalogue codec](../../../packages/plugin-sdk/src/ui/locations.ts)
- [Location registry](../../../apps/ui/src/shared/contrib/uiLocations.ts)
- [Navigation resolver and activator](../../../apps/ui/src/shared/lib/uiNavigation.ts)
- [Catalogue synchronization](../../../apps/ui/src/shared/contrib/uiLocationCatalogSync.ts)
- [Backend catalogue service](../../../apps/api/src/features/ui-locations/service.ts)
