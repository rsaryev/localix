import type { ViteHotContext } from 'vite/types/hot.d.ts'
import type { PluginUiHost } from '@localixai/mini-app-sdk/ui'
import { isContextualUiSurface } from '@localixai/mini-app-sdk/ui'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { pluginUiHost } from './host'
import { registerContextualUiSurface } from './uiSurfaces'
import { registerDiscoveredUiSurfaces, type DiscoveredUiSurface } from './uiSurfaceDiscovery'

/**
 * Generic subsystem-UI discovery — the ONE place CORE turns "some feature slices
 * contribute UI" into actual registrations, WITHOUT naming any individual subsystem.
 *
 * Every feature that contributes editor-grid WorkItem kinds and/or a left-rail
 * section exports a `registerUi()` from its `contrib.{ts,tsx}`. This eager glob
 * imports them all and runs each register hook once at app composition. Adding a
 * new subsystem is therefore just adding its `contrib` file — core references
 * nothing (no per-subsystem imports or calls live here).
 *
 * Every hook receives the {@link PluginUiHost} registration façade. Core feature
 * contribs may ignore it (they can reach the registries directly); PLUGIN hooks
 * should register through it — that's the SDK contract an externally-loaded UI
 * will get too.
 *
 * DISCOVERY IS STAGED, in two phases with different costs:
 *
 *  - `contrib.{ts,tsx}` (EAGER). A rail section and a work-item kind must exist
 *    before the shell paints and before `hydrateGrid()` filters a restored layout,
 *    so these stay on the startup path. There are a handful of them and each is a
 *    thin register hook.
 *  - `*.surface.{ts,tsx}` (STAGED). ~80 colocated declarations, each dragging its
 *    own icon and, for some, its owner's model module. Nothing they feed —
 *    palette, global search, the anchor tree, the agent's published destination
 *    catalog — is consulted during first paint, and every one of those readers is
 *    already revision-subscribed because runtime plugin activation registers
 *    locations late too. So the glob moved behind one lazy boundary
 *    (`uiSurfaceManifest`) and the load is kicked off (not awaited) by
 *    `discoverUi()`: registration still starts at app composition, it simply does
 *    not block the entry chunk.
 *
 * Staging is not "best effort". Anything that must observe the complete core
 * catalog rather than a growing one — notably the agent catalog publication in
 * `uiLocationCatalogSync` — awaits {@link whenUiSurfacesReady} instead of
 * assuming registration already happened.
 */

// Vite eager glob: every `features/<slice>/contrib.ts|tsx` module, imported now.
// The absolute pattern is resolved against the Vite root (apps/ui).
const contribModules = import.meta.glob('/src/features/*/contrib.{ts,tsx}', { eager: true })

// Registry ownership is process-local and first-owner-wins. A self-accept callback
// is insufficient here: changing one eager-glob dependency updates the surface
// module, not necessarily this discovery module. Observe Vite's update envelope
// so added, edited, renamed, and deleted declarations all rebuild the webview
// module graph instead of leaving old metadata registered as a ghost.
//
// Read as Vite's context, because Vite is what serves this module. The app's compile also loads
// bun-types for its tests, and Bun declares `import.meta.hot` too, with an `on` whose callback takes
// nothing — which made Vite's documented payload a type error in the one place that reads it.
const hot = import.meta.hot as unknown as ViteHotContext | undefined
if (hot) {
  const reloadChangedDeclarations = (payload: {
    updates: ReadonlyArray<{ path: string; acceptedPath: string }>
  }) => {
    if (
      payload.updates.some(({ path, acceptedPath }) =>
        [path, acceptedPath].some(
          (candidate) =>
            /\.surface\.[cm]?[jt]sx?$/.test(candidate) ||
            /\/features\/[^/]+\/contrib\.[cm]?[jt]sx?$/.test(candidate),
        ),
      )
    ) {
      platformCapabilities().navigation.reload()
    }
  }
  hot.on('vite:beforeUpdate', reloadChangedDeclarations)
  hot.dispose(() => {
    hot.off('vite:beforeUpdate', reloadChangedDeclarations)
  })
}

let discovered = false
let surfacesReady: Promise<void> | null = null

function registerSurface(surface: DiscoveredUiSurface): boolean {
  return isContextualUiSurface(surface)
    ? registerContextualUiSurface(surface)
    : pluginUiHost.locations.register(surface)
}

/**
 * Resolve once every colocated `*.surface` declaration has been imported and
 * registered. Idempotent, and safe to call before {@link discoverUi}.
 *
 * One `import()` of the manifest, then ONE registration pass over the whole set
 * in the glob's stable path order — so first-owner-wins ownership and duplicate
 * detection stay exactly as deterministic as they were when the glob was eager.
 */
export function whenUiSurfacesReady(): Promise<void> {
  surfacesReady ??= import('./uiSurfaceManifest').then(({ uiSurfaceModules }) => {
    registerDiscoveredUiSurfaces(uiSurfaceModules, registerSurface)
  })
  return surfacesReady
}

/** Register core feature contributions once. Plugin contributions load separately. */
export function discoverUi(): void {
  if (discovered) return
  discovered = true
  for (const mod of Object.values(contribModules)) {
    ;(mod as { registerUi?: (host: PluginUiHost) => void }).registerUi?.(pluginUiHost)
  }
  // Start the staged phase immediately; do not block app composition on it.
  // A surface that fails to register is a silently missing destination, so the
  // failure is rethrown out of band — where the window handler journals it —
  // rather than left as a rejection some other awaiter might quietly absorb.
  void whenUiSurfacesReady().catch((error: unknown) => {
    setTimeout(() => {
      throw error
    })
  })
}
