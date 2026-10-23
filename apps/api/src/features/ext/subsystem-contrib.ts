import type { BackendSubsystem } from '@localixai/mini-app-sdk/backend'

export type { BackendSubsystem } from '@localixai/mini-app-sdk/backend'

/**
 * An open registry for extension-owned backend subsystems. Instead of core hardcoding each subsystem's
 * route mount / resource provider / search provider, a subsystem contributes
 * itself as a `BackendSubsystem` and core iterates the registry generically.
 *
 * All plugin backend surfaces enter the host through this registry.
 */
export interface SubsystemRegistry {
  register(s: BackendSubsystem): void
  /** Remove a subsystem by id — hot plugin disable. Unknown ids are a no-op. */
  unregister(id: string): void
  /** Returns registered subsystems in insertion order. */
  list(): BackendSubsystem[]
}

/** Simple array-backed registry; `list()` preserves insertion order. */
export function createSubsystemRegistry(): SubsystemRegistry {
  const subsystems: BackendSubsystem[] = []
  return {
    register(s) {
      subsystems.push(s)
    },
    unregister(id) {
      const idx = subsystems.findIndex((s) => s.id === id)
      if (idx >= 0) subsystems.splice(idx, 1)
    },
    list() {
      return subsystems.slice()
    },
  }
}
