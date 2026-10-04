import { expect, test } from 'bun:test'
import { createUiLocationRegistry } from '@/shared/contrib/uiLocations'
import surface from './PluginsSidebar.surface'

test('the plugin launcher owns the canonical workspace-section location', () => {
  const registry = createUiLocationRegistry()

  expect(registry.register(surface)).toBe(true)
  expect(surface.uri).toBe('localix://ui/sidebar/plugins')
  expect(registry.resolve(surface.uri)).toMatchObject({
    descriptor: {
      id: 'plugins.open',
      effect: 'read',
      surface: 'sidebar',
      agent: { description: 'Open the plugin launcher' },
      exposure: { search: true, palette: true },
    },
    target: {
      kind: 'rail-section',
      sectionId: 'plugins',
    },
  })
  expect(registry.resolve(`${surface.uri}?unknown=value`)).toBeNull()
})
