import type {
  UiContextualSurfaceDeclaration,
  UiSurfaceCatalogSnapshot,
  UiSurfaceKind,
} from '@localixai/mini-app-sdk/ui'
import { listUiLocations, uiLocationRevision } from './uiLocations'

const UI_SURFACE_KINDS = new Set<UiSurfaceKind>([
  'page',
  'sidebar',
  'work-item',
  'overlay',
  'picker',
  'settings',
  'mini-app',
  'command',
  'action',
])

export interface ContextualUiSurfaceRegistry {
  register(declaration: UiContextualSurfaceDeclaration): boolean
  unregister(id: string): boolean
  list(): UiContextualSurfaceDeclaration[]
  revision(): number
  subscribe(listener: () => void): () => void
}

function validContextualSurface(declaration: UiContextualSurfaceDeclaration): boolean {
  return (
    declaration.kind === 'contextual' &&
    /^[a-z0-9][a-z0-9:._-]{0,127}$/.test(declaration.id) &&
    declaration.title.trim().length > 0 &&
    declaration.title.length <= 120 &&
    UI_SURFACE_KINDS.has(declaration.surface) &&
    (declaration.effect === 'read' || declaration.effect === 'write') &&
    typeof declaration.exposure === 'object' &&
    declaration.exposure !== null &&
    !Array.isArray(declaration.exposure) &&
    Object.keys(declaration.exposure).length === 0 &&
    declaration.reason.trim().length > 0 &&
    declaration.reason.length <= 240
  )
}

export function createContextualUiSurfaceRegistry(): ContextualUiSurfaceRegistry {
  const entries = new Map<string, UiContextualSurfaceDeclaration>()
  const listeners = new Set<() => void>()
  let currentRevision = 0

  return {
    register(declaration) {
      if (!validContextualSurface(declaration)) return false
      const existing = entries.get(declaration.id)
      if (existing === declaration) return true
      if (existing) {
        console.warn(
          `[ui-surfaces] duplicate contextual id "${declaration.id}" — keeping the first owner`,
        )
        return false
      }
      entries.set(declaration.id, Object.freeze({ ...declaration, exposure: {} }))
      currentRevision += 1
      listeners.forEach((listener) => listener())
      return true
    },
    unregister(id) {
      if (!entries.delete(id)) return false
      currentRevision += 1
      listeners.forEach((listener) => listener())
      return true
    },
    list: () => Array.from(entries.values()),
    revision: () => currentRevision,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const contextualRegistry = createContextualUiSurfaceRegistry()

export const registerContextualUiSurface = (declaration: UiContextualSurfaceDeclaration): boolean =>
  contextualRegistry.register(declaration)

export const unregisterContextualUiSurface = (id: string): boolean =>
  contextualRegistry.unregister(id)

/** One in-memory architecture catalog; only location entries are publishable. */
export function uiSurfaceCatalogSnapshot(): UiSurfaceCatalogSnapshot {
  return {
    revision: uiLocationRevision() + contextualRegistry.revision(),
    surfaces: [
      ...listUiLocations().map((location) => ({ kind: 'location' as const, ...location })),
      ...contextualRegistry.list(),
    ],
  }
}
