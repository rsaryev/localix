import { describe, expect, test } from 'bun:test'
import * as manifest from './index'
import * as primitives from './primitives'

import {
  MINI_APP_API_VERSION,
  MINI_APP_CONFIG_TYPES,
  MINI_APP_NAME_RE,
  MINI_APP_QUALIFIED_NAME_RE,
  isWorkbenchMiniApp,
  normalizeMiniAppSurfaces,
  miniAppConfigOptionSchema,
  miniAppManifestCoreSchema,
  type MiniAppConfigOptionInput,
  type MiniAppManifestCoreInput,
} from './index'

describe('mini app name rules', () => {
  test('accepts simple handles, rejects path-ish ones', () => {
    expect(MINI_APP_NAME_RE.test('sample-mini-app')).toBe(true)
    expect(MINI_APP_NAME_RE.test('code-search')).toBe(true)
    expect(MINI_APP_NAME_RE.test('x_search2')).toBe(true)
    expect(MINI_APP_NAME_RE.test('-leading-dash')).toBe(false)
    expect(MINI_APP_NAME_RE.test('has space')).toBe(false)
    expect(MINI_APP_NAME_RE.test('a/b')).toBe(false)
  })

  test('qualified names allow :-namespacing and are a superset of plain names', () => {
    expect(MINI_APP_QUALIFIED_NAME_RE.test('commit')).toBe(true)
    expect(MINI_APP_QUALIFIED_NAME_RE.test('git:commit')).toBe(true)
    expect(MINI_APP_QUALIFIED_NAME_RE.test('a:b:c')).toBe(true)
    expect(MINI_APP_QUALIFIED_NAME_RE.test(':leading')).toBe(false)
    expect(MINI_APP_QUALIFIED_NAME_RE.test('trailing:')).toBe(false)
  })
})

describe('surfaces', () => {
  test('absent/empty declarations default to the agent surface', () => {
    expect(normalizeMiniAppSurfaces(undefined)).toEqual(['agent'])
    expect(normalizeMiniAppSurfaces(null)).toEqual(['agent'])
    expect(normalizeMiniAppSurfaces([])).toEqual(['agent'])
    expect(normalizeMiniAppSurfaces(['  ', ''])).toEqual(['agent'])
  })

  test('normalizes case/whitespace and de-dupes, preserving unknown surfaces', () => {
    expect(normalizeMiniAppSurfaces([' Agent', 'WORKBENCH', 'agent'])).toEqual([
      'agent',
      'workbench',
    ])
    expect(normalizeMiniAppSurfaces(['future-surface'])).toEqual(['future-surface'])
  })

  test('isWorkbenchMiniApp keys off the workbench surface only', () => {
    expect(isWorkbenchMiniApp(['workbench'])).toBe(true)
    expect(isWorkbenchMiniApp(['agent', 'Workbench'])).toBe(true)
    expect(isWorkbenchMiniApp(['agent'])).toBe(false)
    expect(isWorkbenchMiniApp(undefined)).toBe(false)
  })
})

test('the SDK pins mini app API v2, the app layer', () => {
  expect(MINI_APP_API_VERSION).toBe(2)
})

describe('mini app manifest core contract', () => {
  test('accepts one broad category and rejects unknown ones', () => {
    expect(miniAppManifestCoreSchema.parse({ name: 'game', category: 'games' }).category).toBe(
      'games',
    )
    expect(miniAppManifestCoreSchema.safeParse({ name: 'game', category: 'arcade' }).success).toBe(
      false,
    )
  })

  test('owns identity defaults and preserves free-form surface declarations', () => {
    expect(miniAppManifestCoreSchema.parse({ name: 'sample-mini-app' })).toEqual({
      name: 'sample-mini-app',
      version: '0.0.0',
    })
    expect(
      miniAppManifestCoreSchema.parse({
        name: 'sample-mini-app',
        apiVersion: MINI_APP_API_VERSION,
        surfaces: ['agent', 'future-surface'],
      }),
    ).toEqual({
      name: 'sample-mini-app',
      version: '0.0.0',
      apiVersion: MINI_APP_API_VERSION,
      surfaces: ['agent', 'future-surface'],
    })
  })

  test('owns declarative config defaults and preserves display hints', () => {
    expect(MINI_APP_CONFIG_TYPES).toEqual(['string', 'number', 'boolean', 'directory', 'file'])
    const authored = {
      title: 'Tags',
      min: 1,
      max: 3,
    } satisfies MiniAppConfigOptionInput
    expect(miniAppConfigOptionSchema.parse(authored)).toEqual({
      type: 'string',
      description: '',
      required: false,
      secret: false,
      title: 'Tags',
      min: 1,
      max: 3,
    })

    const manifest = {
      name: 'configured',
      config: { API_KEY: { type: 'string', secret: true } },
    } satisfies MiniAppManifestCoreInput
    expect(miniAppManifestCoreSchema.parse(manifest).config).toEqual({
      API_KEY: {
        type: 'string',
        description: '',
        required: false,
        secret: true,
      },
    })
  })

  test('keeps config defaults scalar and rejects unknown option types', () => {
    expect(miniAppConfigOptionSchema.safeParse({ default: null }).success).toBe(false)
    expect(miniAppConfigOptionSchema.safeParse({ default: ['a'] }).success).toBe(false)
    expect(miniAppConfigOptionSchema.safeParse({ type: 'json' }).success).toBe(false)
  })

  test('rejects invalid names and API versions at the shared boundary', () => {
    expect(miniAppManifestCoreSchema.safeParse({ name: 'bad/name' }).success).toBe(false)
    expect(miniAppManifestCoreSchema.safeParse({ name: 'ok', apiVersion: 0 }).success).toBe(false)
    expect(miniAppManifestCoreSchema.safeParse({ name: 'ok', apiVersion: 1.5 }).success).toBe(false)
  })
  test('accepts a generic private distribution marker', () => {
    expect(miniAppManifestCoreSchema.parse({ name: 'scaffold', private: true }).private).toBe(true)
  })
})

test('the compatibility manifest retains the same primitive objects and functions', () => {
  expect(manifest.MINI_APP_NAME_RE).toBe(primitives.MINI_APP_NAME_RE)
  expect(manifest.MINI_APP_QUALIFIED_NAME_RE).toBe(primitives.MINI_APP_QUALIFIED_NAME_RE)
  expect(manifest.MINI_APP_CONFIG_TYPES).toBe(primitives.MINI_APP_CONFIG_TYPES)
  expect(manifest.MINI_APP_CATEGORIES).toBe(primitives.MINI_APP_CATEGORIES)
  expect(manifest.normalizeMiniAppSurfaces).toBe(primitives.normalizeMiniAppSurfaces)
  expect(manifest.isWorkbenchMiniApp).toBe(primitives.isWorkbenchMiniApp)
})
