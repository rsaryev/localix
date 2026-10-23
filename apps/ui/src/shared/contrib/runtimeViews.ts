import type { MiniAppViewSpec } from '@/shared/api/contracts'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'
import { clearPanelActions } from './miniAppPanelActions'
import {
  batchUiLocationChanges,
  miniAppLocationId,
  registerUiLocation,
  unregisterUiLocation,
} from './uiLocations'

/**
 * The RUNTIME third-party UI discovery pass — the installed-plugin counterpart
 * to the build-time eager glob in `discover.ts`. Where `discover.ts` statically
 * imports BUNDLED plugin UI (trusted, native, never removed), THIS module holds
 * the views declared by ENABLED third-party plugins, fetched as DATA from
 * `GET /rpc/plugins/views` (never code), each rendered as a sandboxed bridged
 * iframe in a work-item TAB — the single placement, so this store is one flat map. Because installed plugins can be disabled/uninstalled, these
 * registrations are REMOVABLE: {@link syncThirdPartyViews} reconciles the store
 * to exactly the current enabled set — a plugin that drops out is gone on the
 * next sync (unlike the static glob). A tiny subscribe/version store so React
 * surfaces re-render via `useSyncExternalStore` when the set changes.
 */

const views = new Map<string, MiniAppViewSpec>()
const listeners = new Set<() => void>()
let version = 0
let locationIds = new Set<string>()

function syncViewLocations(specs: readonly MiniAppViewSpec[]): void {
  const nextIds = new Set<string>()
  const accepted = batchUiLocationChanges(() => {
    for (const id of locationIds) unregisterUiLocation(id)
    for (const spec of specs) {
      const id = miniAppLocationId('plugin-view.open', spec.fullName)
      const registered = registerUiLocation(
        defineUiLocation({
          id,
          uri: `localix://ui/plugin/view/${encodeURIComponent(spec.fullName)}`,
          title: spec.title,
          description: `Open ${spec.app} plugin view`,
          ...(spec.agentDescription ? { agent: { description: spec.agentDescription } } : {}),
          keywords: [spec.app, 'plugin'],
          group: 'Plugins',
          pluginName: spec.app,
          effect: 'read',
          surface: 'plugin',
          exposure: { search: true },
          resolve: () => ({
            kind: 'work-item',
            workKind: 'plugin-view',
            id: `plugin-view:${spec.fullName}`,
            title: spec.title,
            payload: {
              pluginName: spec.app,
              projectId: spec.projectId,
              viewId: spec.id,
            },
          }),
        }),
      )
      if (!registered) return false
      nextIds.add(id)
    }
    return true
  })
  if (!accepted) return
  locationIds = nextIds
}

function sameView(left: MiniAppViewSpec, right: MiniAppViewSpec): boolean {
  return (
    left.app === right.app &&
    left.projectId === right.projectId &&
    left.id === right.id &&
    left.fullName === right.fullName &&
    left.title === right.title &&
    left.icon === right.icon &&
    left.agentDescription === right.agentDescription
  )
}

function sameViews(
  current: ReadonlyMap<string, MiniAppViewSpec>,
  next: ReadonlyMap<string, MiniAppViewSpec>,
): boolean {
  if (current.size !== next.size) return false
  for (const [fullName, spec] of next) {
    const existing = current.get(fullName)
    if (!existing || !sameView(existing, spec)) return false
  }
  return true
}

/**
 * Replace the registered third-party views with exactly `specs` (the enabled set
 * from the server). Removal is implicit: any previously-registered view NOT in
 * `specs` — a disabled/uninstalled plugin — is dropped, and its per-plugin custom
 * actions are cleared. Bumps the version + notifies subscribers only when the
 * registered set actually changed, so an idempotent re-sync is a no-op render.
 */
export function syncThirdPartyViews(specs: MiniAppViewSpec[]): void {
  const next = new Map<string, MiniAppViewSpec>()
  for (const spec of specs) next.set(spec.fullName, spec)
  if (sameViews(views, next)) return

  const prevPlugins = new Set([...views.values()].map((v) => v.app))
  views.clear()
  for (const [fullName, spec] of next) views.set(fullName, spec)
  syncViewLocations(specs)

  // Clear custom actions for plugins that no longer contribute any view.
  const nextPlugins = new Set([...next.values()].map((v) => v.app))
  for (const plugin of prevPlugins) if (!nextPlugins.has(plugin)) clearPanelActions(plugin)

  version += 1
  for (const l of listeners) l()
}

export function subscribeThirdPartyViews(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Monotonic snapshot id for `useSyncExternalStore` — changes on every real sync. */
export function thirdPartyViewsVersion(): number {
  return version
}

/** Registered plugin views — each opens as an editor-grid tab from a rail button. */
export function listThirdPartyViews(): MiniAppViewSpec[] {
  return [...views.values()]
}

/** Test seam: forget every registered view (does not notify). */
export function __resetThirdPartyViews(): void {
  for (const id of locationIds) unregisterUiLocation(id)
  locationIds = new Set()
  views.clear()
  version = 0
}
