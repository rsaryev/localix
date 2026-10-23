import { describe, expect, spyOn, test } from 'bun:test'
import {
  defineContextualUiSurface,
  type UiContextualSurfaceDeclaration,
} from '@localixai/mini-app-sdk/ui'
import { registerUiLocation, unregisterUiLocation } from './uiLocations'
import {
  createContextualUiSurfaceRegistry,
  registerContextualUiSurface,
  uiSurfaceCatalogSnapshot,
  unregisterContextualUiSurface,
} from './uiSurfaces'

const contextual = (id: string) =>
  defineContextualUiSurface({
    id,
    title: id,
    surface: 'work-item',
    effect: 'read',
    exposure: {},
    reason: 'Requires payload owned by its parent work item.',
  })

describe('ContextualUiSurfaceRegistry', () => {
  test('stores validated declarations in memory without publication metadata', () => {
    const registry = createContextualUiSurfaceRegistry()
    const declaration = contextual('context.test.valid')

    expect(registry.register(declaration)).toBe(true)
    expect(registry.list()).toEqual([declaration])
    expect(registry.revision()).toBe(1)
    expect(registry.unregister(declaration.id)).toBe(true)
    expect(registry.list()).toEqual([])
    expect(registry.revision()).toBe(2)
  })

  test('rejects missing, publishable, malformed, and colliding declarations', () => {
    const registry = createContextualUiSurfaceRegistry()
    const valid = contextual('context.test.metadata')
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(registry.register(valid)).toBe(true)
      for (const malformed of [
        { ...valid, kind: undefined },
        { ...valid, id: 'context.test.missing-reason', reason: '' },
        { ...valid, id: 'context.test.publishable', exposure: { search: true } },
        { ...valid, id: 'context.test.array-exposure', exposure: [] },
        { ...valid, id: 'context.test.effect', effect: 'execute' },
        { ...valid, id: 'context.test.surface', surface: 'dialog' },
      ]) {
        expect(registry.register(malformed as unknown as UiContextualSurfaceDeclaration)).toBe(
          false,
        )
      }
      expect(registry.register({ ...valid })).toBe(false)
      // Count only THIS module's warnings. `console.warn` is process-wide and `bun test`
      // runs every file in one process, so a spy's window also collects whatever other
      // suites' pending async work logs — a raw call count is not this test's alone.
      expect(
        warn.mock.calls.filter((call) => String(call[0]).includes('[ui-surfaces] duplicate')),
      ).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })
})

test('the common in-memory catalog contains locations and contextual boundaries', () => {
  const locationId = 'catalog.test.location'
  const contextualId = 'context.catalog.test'
  expect(
    registerUiLocation({
      id: locationId,
      uri: 'localix://ui/work-item/catalog-test',
      title: 'Catalog test location',
      effect: 'read',
      surface: 'work-item',
      exposure: {},
      resolve: () => ({
        kind: 'work-item',
        workKind: 'catalog-test',
        id: 'catalog-test',
        title: 'Catalog test',
      }),
    }),
  ).toBe(true)
  expect(registerContextualUiSurface(contextual(contextualId))).toBe(true)

  try {
    expect(
      uiSurfaceCatalogSnapshot().surfaces.filter(
        (entry) => entry.id === locationId || entry.id === contextualId,
      ),
    ).toEqual([
      expect.objectContaining({ kind: 'location', id: locationId }),
      expect.objectContaining({
        kind: 'contextual',
        id: contextualId,
        exposure: {},
      }),
    ])
  } finally {
    unregisterUiLocation(locationId)
    unregisterContextualUiSurface(contextualId)
  }
})
