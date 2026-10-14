import type {
  UiContextualSurfaceDeclaration,
  UiLocationContribution,
  UiLocationParamSchema,
} from '@localixai/plugin-sdk/ui'

export type DiscoveredUiSurface =
  | UiLocationContribution<UiLocationParamSchema>
  | UiContextualSurfaceDeclaration

type SurfaceModule = { default?: DiscoveredUiSurface }

/**
 * Validate and register every statically discovered surface. This deliberately
 * fails startup/build tests: a `*.surface` file is an architectural declaration,
 * never an optional best-effort side effect.
 */
export function registerDiscoveredUiSurfaces(
  modules: Record<string, unknown>,
  register: (surface: DiscoveredUiSurface) => boolean,
): void {
  const owners = new Map<string, string>()
  for (const [path, mod] of Object.entries(modules)) {
    const surface = (mod as SurfaceModule).default
    if (!surface) {
      throw new Error(`[ui-surfaces] ${path} must default-export a UI surface descriptor`)
    }
    const existingOwner = owners.get(surface.id)
    if (existingOwner) {
      throw new Error(
        `[ui-surfaces] ${path} duplicates "${surface.id}" already declared by ${existingOwner}`,
      )
    }
    owners.set(surface.id, path)
    if (!register(surface)) {
      throw new Error(
        `[ui-surfaces] ${path} has invalid or colliding metadata for "${surface.id ?? 'unknown'}"`,
      )
    }
  }
}
