import { describe, expect, test } from 'bun:test'
import {
  MINI_APP_SURFACE_AGENT,
  MINI_APP_SURFACE_WORKBENCH,
  isWorkbenchMiniApp,
  normalizeMiniAppSurfaces,
  miniAppManifestCoreSchema,
} from './contracts-base'
import { pluginManifestSchema } from './contracts'

describe('normalizeMiniAppSurfaces', () => {
  test('absent/empty declaration falls back to the agent surface', () => {
    expect(normalizeMiniAppSurfaces(undefined)).toEqual([MINI_APP_SURFACE_AGENT])
    expect(normalizeMiniAppSurfaces(null)).toEqual([MINI_APP_SURFACE_AGENT])
    expect(normalizeMiniAppSurfaces([])).toEqual([MINI_APP_SURFACE_AGENT])
    expect(normalizeMiniAppSurfaces(['  ', ''])).toEqual([MINI_APP_SURFACE_AGENT])
  })

  test('trims, lower-cases and de-dupes', () => {
    expect(normalizeMiniAppSurfaces([' Workbench ', 'workbench', 'AGENT'])).toEqual([
      'workbench',
      'agent',
    ])
  })

  test('carries an UNKNOWN surface through instead of rejecting it', () => {
    // A future host can give a new surface meaning without a manifest migration.
    expect(normalizeMiniAppSurfaces(['terminal'])).toEqual(['terminal'])
  })
})

describe('isWorkbenchMiniApp', () => {
  test('true only when the workbench surface is declared', () => {
    expect(isWorkbenchMiniApp([MINI_APP_SURFACE_WORKBENCH])).toBe(true)
    // A workbench plugin that ALSO ships agent tools still belongs to the workbench bucket.
    expect(isWorkbenchMiniApp([MINI_APP_SURFACE_AGENT, MINI_APP_SURFACE_WORKBENCH])).toBe(true)
    expect(isWorkbenchMiniApp([MINI_APP_SURFACE_AGENT])).toBe(false)
    expect(isWorkbenchMiniApp(undefined)).toBe(false)
    expect(isWorkbenchMiniApp(['terminal'])).toBe(false)
  })
})

describe('manifest', () => {
  test('inherits every SDK-owned core field without host overrides', () => {
    for (const field of ['name', 'version', 'apiVersion', 'surfaces', 'config'] as const) {
      expect(pluginManifestSchema.shape[field]).toBe(miniAppManifestCoreSchema.shape[field])
    }
  })

  test('accepts a declared surfaces array and stays optional', () => {
    const withSurfaces = pluginManifestSchema.parse({
      name: 'db',
      surfaces: ['agent', 'workbench'],
    })
    expect(withSurfaces.surfaces).toEqual(['agent', 'workbench'])
    expect(pluginManifestSchema.parse({ name: 'plain' }).surfaces).toBeUndefined()
  })
})
