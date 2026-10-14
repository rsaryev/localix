import { describe, expect, test } from 'bun:test'
import {
  PLUGIN_SURFACE_AGENT,
  PLUGIN_SURFACE_WORKBENCH,
  isWorkbenchPlugin,
  normalizePluginSurfaces,
  pluginManifestCoreSchema,
} from './contracts-base'
import { pluginManifestSchema } from './contracts'

describe('normalizePluginSurfaces', () => {
  test('absent/empty declaration falls back to the agent surface', () => {
    expect(normalizePluginSurfaces(undefined)).toEqual([PLUGIN_SURFACE_AGENT])
    expect(normalizePluginSurfaces(null)).toEqual([PLUGIN_SURFACE_AGENT])
    expect(normalizePluginSurfaces([])).toEqual([PLUGIN_SURFACE_AGENT])
    expect(normalizePluginSurfaces(['  ', ''])).toEqual([PLUGIN_SURFACE_AGENT])
  })

  test('trims, lower-cases and de-dupes', () => {
    expect(normalizePluginSurfaces([' Workbench ', 'workbench', 'AGENT'])).toEqual([
      'workbench',
      'agent',
    ])
  })

  test('carries an UNKNOWN surface through instead of rejecting it', () => {
    // A future host can give a new surface meaning without a manifest migration.
    expect(normalizePluginSurfaces(['terminal'])).toEqual(['terminal'])
  })
})

describe('isWorkbenchPlugin', () => {
  test('true only when the workbench surface is declared', () => {
    expect(isWorkbenchPlugin([PLUGIN_SURFACE_WORKBENCH])).toBe(true)
    // A workbench plugin that ALSO ships agent tools still belongs to the workbench bucket.
    expect(isWorkbenchPlugin([PLUGIN_SURFACE_AGENT, PLUGIN_SURFACE_WORKBENCH])).toBe(true)
    expect(isWorkbenchPlugin([PLUGIN_SURFACE_AGENT])).toBe(false)
    expect(isWorkbenchPlugin(undefined)).toBe(false)
    expect(isWorkbenchPlugin(['terminal'])).toBe(false)
  })
})

describe('manifest', () => {
  test('inherits every SDK-owned core field without host overrides', () => {
    for (const field of ['name', 'version', 'apiVersion', 'surfaces', 'config'] as const) {
      expect(pluginManifestSchema.shape[field]).toBe(pluginManifestCoreSchema.shape[field])
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
