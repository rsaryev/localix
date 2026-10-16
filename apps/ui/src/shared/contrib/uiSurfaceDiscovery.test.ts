import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type {
  UiContextualSurfaceDeclaration,
  UiLocationContribution,
  UiLocationParamDefinition,
  UiLocationParamSchema,
} from '@localixai/plugin-sdk/ui'
import { isContextualUiSurface } from '@localixai/plugin-sdk/ui'
import { registerDiscoveredUiSurfaces } from './uiSurfaceDiscovery'
import { createUiLocationRegistry } from './uiLocations'
import { createContextualUiSurfaceRegistry } from './uiSurfaces'

const discovery =
  readFileSync(new URL('./discover.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./uiSurfaceManifest.ts', import.meta.url), 'utf8')
const workspaceViews = readFileSync(
  new URL('../../features/workspace-grid/contrib.ts', import.meta.url),
  'utf8',
)
const sourceRoot = fileURLToPath(new URL('../..', import.meta.url))
// The kit's primitives declare surfaces too, from outside the app's source root.
const kitSourceRoot = fileURLToPath(new URL('../../../../../packages/kit/src', import.meta.url))

async function loadAppSurfaces(): Promise<
  Array<{
    path: string
    surface: UiLocationContribution<UiLocationParamSchema> | UiContextualSurfaceDeclaration
  }>
> {
  const paths = [sourceRoot, kitSourceRoot].flatMap((root) =>
    [...new Bun.Glob('**/*.surface.{ts,tsx}').scanSync({ cwd: root })].sort().map((path) => ({
      root,
      path,
    })),
  )
  return Promise.all(
    paths.map(async ({ root, path }) => {
      const module = (await import(pathToFileURL(join(root, path)).href)) as {
        default?: UiLocationContribution<UiLocationParamSchema> | UiContextualSurfaceDeclaration
      }
      if (!module.default) throw new Error(`${path} must default-export a UI surface`)
      return { path, surface: module.default }
    }),
  )
}

function sampleValue(definition: UiLocationParamDefinition): string | string[] | boolean | number {
  if (definition.type === 'boolean') return true
  if (definition.type === 'integer') return definition.minimum ?? 1
  if (definition.type === 'string-array') return ['fixture']
  return definition.values?.[0] ?? 'fixture'
}

function buildableArgs(schema: UiLocationParamSchema | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema ?? {})
      .filter(([, definition]) => !definition.optional)
      .map(([key, definition]) => [key, sampleValue(definition)]),
  )
}

describe('UI surface discovery architecture', () => {
  test('discovers feature-owned surface descriptors without naming their owners', () => {
    expect(discovery).toContain('/src/**/*.surface.{ts,tsx}')
    expect(discovery).toContain('packages/kit/src/**/*.surface.{ts,tsx}')
    expect(discovery).toContain('registerDiscoveredUiSurfaces(uiSurfaceModules, registerSurface)')
    expect(discovery).not.toContain('typeof import.meta.glob')

    for (const feature of ['terminal', 'model-picker', 'global-search']) {
      expect(discovery).not.toContain(`'${feature}'`)
    }
  })

  test('the workspace anchor lists the live catalog instead of a core view mirror', () => {
    expect(workspaceViews).toContain("listUiLocations({ exposure: 'search' })")
    expect(workspaceViews).not.toContain('CORE_VIEWS')
    expect(workspaceViews).not.toContain('uri === `${ROOT}/global-search`')
  })

  test('loads every colocated app surface, including shared and deeply nested owners', async () => {
    const surfaces = await loadAppSurfaces()

    expect(surfaces.length).toBeGreaterThan(0)
    expect(surfaces.some(({ path }) => path.startsWith('shared/'))).toBe(true)
    expect(surfaces.some(({ path }) => path.split('/').length > 2)).toBe(true)
    for (const { path, surface } of surfaces) {
      expect(surface.id, path).toBeTruthy()
      expect(surface.effect, path).toMatch(/^(read|write)$/)
      expect(surface.surface, path).toBeTruthy()
      expect(surface.exposure, path).toBeTruthy()
      if (isContextualUiSurface(surface)) {
        expect(surface.reason.trim(), path).toBeTruthy()
        expect(surface.exposure, path).toEqual({})
      } else {
        expect(surface.uri, path).toBeTruthy()
        expect(typeof surface.resolve, path).toBe('function')
      }
    }
  })

  test('registers, builds, and resolves every discovered core surface without collisions', async () => {
    const registry = createUiLocationRegistry()
    const contextualRegistry = createContextualUiSurfaceRegistry()
    const surfaces = await loadAppSurfaces()
    const modules = Object.fromEntries(
      surfaces.map(({ path, surface }) => [path, { default: surface }]),
    )

    expect(() =>
      registerDiscoveredUiSurfaces(modules, (surface) =>
        isContextualUiSurface(surface)
          ? contextualRegistry.register(surface)
          : registry.register(surface),
      ),
    ).not.toThrow()
    const locations = surfaces.filter(
      (
        entry,
      ): entry is typeof entry & {
        surface: UiLocationContribution<UiLocationParamSchema>
      } => !isContextualUiSurface(entry.surface),
    )
    const contextual = surfaces.filter(({ surface }) => isContextualUiSurface(surface))
    expect(registry.list()).toHaveLength(locations.length)
    expect(contextualRegistry.list()).toHaveLength(contextual.length)

    for (const { path, surface } of locations) {
      const uri = registry.build(surface.id, buildableArgs(surface.params))
      if (surface.agent?.availability === 'runtime') {
        expect(uri, `${path} must fail closed without its live runtime target`).toBeNull()
        expect(registry.list().find((entry) => entry.id === surface.id)?.agent?.availability).toBe(
          'runtime',
        )
        continue
      }
      expect(uri, `${path} must build with representative arguments`).not.toBeNull()
      const resolved = registry.resolve(uri!)
      expect(resolved, `${path} must resolve its own canonical URI`).not.toBeNull()
      expect(resolved?.descriptor.id).toBe(surface.id)
      expect(resolved?.descriptor.effect).toBe('read')
      expect(resolved?.descriptor.agent?.description).toBeTruthy()
      expect(resolved?.target.kind).toBeTruthy()
      expect(resolved?.presentation.label.trim()).toBeTruthy()
    }
    expect(registry.list({ exposure: 'agent' }).every((entry) => entry.effect === 'read')).toBe(
      true,
    )
    expect(
      registry
        .list({ exposure: 'agent' })
        .find((entry) => entry.uri === 'localix://ui/settings/root')?.title,
    ).toBe('Settings')
    expect(
      registry
        .list({ exposure: 'agent' })
        .find((entry) => entry.uri === 'localix://ui/settings/plugins'),
    ).toMatchObject({
      id: 'settings.plugins.open',
      title: 'Plugins',
      agent: { description: 'Open installed plugin settings' },
    })
  })

  test('fails discovery when a surface module has no valid default descriptor', () => {
    const registry = createUiLocationRegistry()
    const contextualRegistry = createContextualUiSurfaceRegistry()
    const register = (
      surface: UiLocationContribution<UiLocationParamSchema> | UiContextualSurfaceDeclaration,
    ) =>
      isContextualUiSurface(surface)
        ? contextualRegistry.register(surface)
        : registry.register(surface)

    expect(() =>
      registerDiscoveredUiSurfaces(
        { 'missing.surface.ts': {}, 'not-a-location.surface.ts': { default: { id: '' } } },
        register,
      ),
    ).toThrow('missing.surface.ts must default-export a UI surface descriptor')

    expect(() =>
      registerDiscoveredUiSurfaces(
        { 'not-a-location.surface.ts': { default: { id: '' } } },
        register,
      ),
    ).toThrow('not-a-location.surface.ts has invalid or colliding metadata')
  })

  test('fails discovery deterministically on a duplicate surface owner', async () => {
    const registry = createUiLocationRegistry()
    const contextualRegistry = createContextualUiSurfaceRegistry()
    const [{ surface }] = await loadAppSurfaces()

    expect(() =>
      registerDiscoveredUiSurfaces(
        {
          'first.surface.ts': { default: surface },
          'duplicate.surface.ts': { default: { ...surface } },
        },
        (candidate) =>
          isContextualUiSurface(candidate)
            ? contextualRegistry.register(candidate)
            : registry.register(candidate),
      ),
    ).toThrow(
      `duplicate.surface.ts duplicates "${surface.id}" already declared by first.surface.ts`,
    )
  })
})
