import { describe, expect, test } from 'bun:test'
import * as manifest from './index'
import * as primitives from './primitives'

import {
  PLUGIN_API_VERSION,
  PLUGIN_CONFIG_TYPES,
  PLUGIN_NAME_RE,
  PLUGIN_QUALIFIED_NAME_RE,
  isWorkbenchPlugin,
  normalizePluginSurfaces,
  pluginConfigOptionSchema,
  pluginManifestCoreSchema,
  type PluginConfigOptionInput,
  type PluginManifestCoreInput,
} from './index'

describe('plugin name rules', () => {
  test('accepts simple handles, rejects path-ish ones', () => {
    expect(PLUGIN_NAME_RE.test('sample-plugin')).toBe(true)
    expect(PLUGIN_NAME_RE.test('code-search')).toBe(true)
    expect(PLUGIN_NAME_RE.test('x_search2')).toBe(true)
    expect(PLUGIN_NAME_RE.test('-leading-dash')).toBe(false)
    expect(PLUGIN_NAME_RE.test('has space')).toBe(false)
    expect(PLUGIN_NAME_RE.test('a/b')).toBe(false)
  })

  test('qualified names allow :-namespacing and are a superset of plain names', () => {
    expect(PLUGIN_QUALIFIED_NAME_RE.test('commit')).toBe(true)
    expect(PLUGIN_QUALIFIED_NAME_RE.test('git:commit')).toBe(true)
    expect(PLUGIN_QUALIFIED_NAME_RE.test('a:b:c')).toBe(true)
    expect(PLUGIN_QUALIFIED_NAME_RE.test(':leading')).toBe(false)
    expect(PLUGIN_QUALIFIED_NAME_RE.test('trailing:')).toBe(false)
  })
})

describe('surfaces', () => {
  test('absent/empty declarations default to the agent surface', () => {
    expect(normalizePluginSurfaces(undefined)).toEqual(['agent'])
    expect(normalizePluginSurfaces(null)).toEqual(['agent'])
    expect(normalizePluginSurfaces([])).toEqual(['agent'])
    expect(normalizePluginSurfaces(['  ', ''])).toEqual(['agent'])
  })

  test('normalizes case/whitespace and de-dupes, preserving unknown surfaces', () => {
    expect(normalizePluginSurfaces([' Agent', 'WORKBENCH', 'agent'])).toEqual([
      'agent',
      'workbench',
    ])
    expect(normalizePluginSurfaces(['future-surface'])).toEqual(['future-surface'])
  })

  test('isWorkbenchPlugin keys off the workbench surface only', () => {
    expect(isWorkbenchPlugin(['workbench'])).toBe(true)
    expect(isWorkbenchPlugin(['agent', 'Workbench'])).toBe(true)
    expect(isWorkbenchPlugin(['agent'])).toBe(false)
    expect(isWorkbenchPlugin(undefined)).toBe(false)
  })
})

test('the SDK pins plugin API v1', () => {
  expect(PLUGIN_API_VERSION).toBe(1)
})

describe('plugin manifest core contract', () => {
  test('accepts one broad category and rejects unknown ones', () => {
    expect(pluginManifestCoreSchema.parse({ name: 'game', category: 'games' }).category).toBe(
      'games',
    )
    expect(pluginManifestCoreSchema.safeParse({ name: 'game', category: 'arcade' }).success).toBe(
      false,
    )
  })

  test('owns identity defaults and preserves free-form surface declarations', () => {
    expect(pluginManifestCoreSchema.parse({ name: 'sample-plugin' })).toEqual({
      name: 'sample-plugin',
      version: '0.0.0',
    })
    expect(
      pluginManifestCoreSchema.parse({
        name: 'sample-plugin',
        apiVersion: PLUGIN_API_VERSION,
        surfaces: ['agent', 'future-surface'],
      }),
    ).toEqual({
      name: 'sample-plugin',
      version: '0.0.0',
      apiVersion: PLUGIN_API_VERSION,
      surfaces: ['agent', 'future-surface'],
    })
  })

  test('owns declarative config defaults and preserves compatibility hints', () => {
    expect(PLUGIN_CONFIG_TYPES).toEqual(['string', 'number', 'boolean', 'directory', 'file'])
    const authored = {
      title: 'Tags',
      multiple: true,
      min: 1,
      max: 3,
    } satisfies PluginConfigOptionInput
    expect(pluginConfigOptionSchema.parse(authored)).toEqual({
      type: 'string',
      description: '',
      required: false,
      secret: false,
      title: 'Tags',
      multiple: true,
      min: 1,
      max: 3,
    })

    const manifest = {
      name: 'configured',
      config: { API_KEY: { type: 'string', secret: true } },
    } satisfies PluginManifestCoreInput
    expect(pluginManifestCoreSchema.parse(manifest).config).toEqual({
      API_KEY: {
        type: 'string',
        description: '',
        required: false,
        secret: true,
      },
    })
  })

  test('keeps config defaults scalar and rejects unknown option types', () => {
    expect(pluginConfigOptionSchema.safeParse({ default: null }).success).toBe(false)
    expect(pluginConfigOptionSchema.safeParse({ default: ['a'] }).success).toBe(false)
    expect(pluginConfigOptionSchema.safeParse({ type: 'json' }).success).toBe(false)
  })

  test('rejects invalid names and API versions at the shared boundary', () => {
    expect(pluginManifestCoreSchema.safeParse({ name: 'bad/name' }).success).toBe(false)
    expect(pluginManifestCoreSchema.safeParse({ name: 'ok', apiVersion: 0 }).success).toBe(false)
    expect(pluginManifestCoreSchema.safeParse({ name: 'ok', apiVersion: 1.5 }).success).toBe(false)
  })
  test('accepts a generic private distribution marker', () => {
    expect(pluginManifestCoreSchema.parse({ name: 'scaffold', private: true }).private).toBe(true)
  })
})

test('the compatibility manifest retains the same primitive objects and functions', () => {
  expect(manifest.PLUGIN_NAME_RE).toBe(primitives.PLUGIN_NAME_RE)
  expect(manifest.PLUGIN_QUALIFIED_NAME_RE).toBe(primitives.PLUGIN_QUALIFIED_NAME_RE)
  expect(manifest.PLUGIN_CONFIG_TYPES).toBe(primitives.PLUGIN_CONFIG_TYPES)
  expect(manifest.PLUGIN_CATEGORIES).toBe(primitives.PLUGIN_CATEGORIES)
  expect(manifest.normalizePluginSurfaces).toBe(primitives.normalizePluginSurfaces)
  expect(manifest.isWorkbenchPlugin).toBe(primitives.isWorkbenchPlugin)
})
