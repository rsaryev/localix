import type {
  MiniAppWorkItemRequest,
  RailSectionContribution,
  RailViewletContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'
import { isMiniAppContributionEnabled } from './miniAppActivation'

/**
 * OPEN UI registries mirroring the backend `SubsystemRegistry`: a bundled
 * subsystem contributes its editor-grid WorkItem kind(s) and its left-rail
 * section here instead of core hardcoding them in the render/icon/capability/
 * section maps. Each feature registers itself from its `contrib.{ts,tsx}`
 * (discovered generically — see `shared/contrib/discover.ts`), so CORE names no
 * individual subsystem.
 *
 * The contribution CONTRACTS are OWNED by `@localixai/mini-app-sdk/ui` (plugins
 * compile against the SDK); this module implements the registries and re-exports
 * the types so internal `@/shared/contrib/*` import sites stay unchanged.
 *
 * Core lookups consult these registries FIRST and fall back to the built-in
 * maps for the remaining core kinds. Module-singleton Maps keyed by kind|id.
 */
export type {
  RailSectionContribution,
  RailViewletContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'

interface Registry<T> {
  register(x: T): void
  /** Lookup regardless of live plugin activation (used only by cold persistence). */
  getRegistered(key: string): T | undefined
  get(key: string): T | undefined
  /** Returns entries in insertion order. */
  list(): T[]
  /** Drop every entry `owner` registered; core entries (no owner) are never touched. */
  removeOwner(owner: string): void
}

/** Map-backed registry keyed by the entry's `kind` or `id`. */
function createRegistry<T extends { kind?: string; id?: string; pluginName?: string }>(
  label: string,
): Registry<T> {
  const entries = new Map<string, T>()
  return {
    register(x) {
      const key = x.kind ?? x.id
      if (!key) return
      const existing = entries.get(key)
      if (existing === x) return
      if (existing) {
        console.warn(`[ui-contrib] duplicate ${label} "${key}" — keeping the first owner`)
        return
      }
      entries.set(key, x)
    },
    getRegistered(key) {
      return entries.get(key)
    },
    get(key) {
      const entry = entries.get(key)
      return entry && isMiniAppContributionEnabled(entry.pluginName) ? entry : undefined
    },
    list() {
      return Array.from(entries.values()).filter((entry) =>
        isMiniAppContributionEnabled(entry.pluginName),
      )
    },
    removeOwner(owner) {
      for (const [key, entry] of entries) if (entry.pluginName === owner) entries.delete(key)
    },
  }
}

export const workItemKindRegistry = createRegistry<WorkItemKindContribution>('work-item kind')
export const railSectionRegistry = createRegistry<RailSectionContribution>('rail section')
export const railViewletRegistry = createRegistry<RailViewletContribution>('rail viewlet')

/**
 * A contributed kind's manifest owner also owns every process-global work-item
 * instance id created under that kind. Core kinds have no pluginName and retain
 * their existing id contracts.
 */
export function assertMiniAppOwnedWorkItemInstance(request: MiniAppWorkItemRequest): void {
  const owner = workItemKindRegistry.getRegistered(request.workKind)?.pluginName
  if (!owner || request.id.startsWith(`${owner}:`)) return
  throw new Error(
    `[plugin-ui] work-item instance "${request.id}" must be namespaced by owner "${owner}:"`,
  )
}
