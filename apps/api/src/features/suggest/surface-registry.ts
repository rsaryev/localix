import type { MiniAppTextInputCompletionSurface } from '@localixai/mini-app-sdk/backend'

/**
 * Every mini app's text-input completion surfaces, side by side.
 *
 * These used to be ONE capability (`textInput.completion`), and a capability is first-wins: the
 * first mini app to declare it owned every contributed surface, and a second mini app's fields were
 * warned about and ignored. Surfaces are keyed by their own id here, so two mini apps never
 * compete, and an id must carry its owner's namespace, so no mini app can answer for another's
 * field.
 */

export type SurfaceRegistration =
  | { status: 'registered' }
  | { status: 'rejected'; reason: 'namespace' | 'duplicate' }

export interface TextInputSurfaceRegistry {
  register(
    surface: MiniAppTextInputCompletionSurface,
    owner: { miniApp: string; source: string },
  ): SurfaceRegistration
  /** Register every surface a subsystem declares; a rejection is warned, never thrown. */
  registerAll(
    surfaces: readonly MiniAppTextInputCompletionSurface[] | undefined,
    owner: { miniApp: string; source: string },
    warn?: (msg: string, meta?: unknown) => void,
  ): void
  unregisterBySource(source: string): void
  get(id: string): MiniAppTextInputCompletionSurface | undefined
}

export function createTextInputSurfaceRegistry(): TextInputSurfaceRegistry {
  const entries = new Map<string, { surface: MiniAppTextInputCompletionSurface; source: string }>()
  const register: TextInputSurfaceRegistry['register'] = (surface, owner) => {
    if (
      !surface.id.startsWith(`${owner.miniApp}.`) ||
      surface.id.length <= owner.miniApp.length + 1
    )
      return { status: 'rejected', reason: 'namespace' }
    if (entries.has(surface.id)) return { status: 'rejected', reason: 'duplicate' }
    entries.set(surface.id, { surface, source: owner.source })
    return { status: 'registered' }
  }
  return {
    register,
    registerAll(surfaces, owner, warn) {
      for (const surface of surfaces ?? []) {
        const outcome = register(surface, owner)
        if (outcome.status === 'rejected')
          warn?.(`text-input completion surface rejected for "${owner.source}"`, {
            surfaceId: surface.id,
            reason: outcome.reason,
          })
      }
    },
    unregisterBySource(source) {
      for (const [id, entry] of entries) if (entry.source === source) entries.delete(id)
    },
    get: (id) => entries.get(id)?.surface,
  }
}
