import { expect, test } from 'bun:test'

import { createUiLocationRegistry } from './uiLocations'

test('equal search scores retain raw title and URI ordering without reordering the registry', () => {
  const registry = createUiLocationRegistry()
  for (const [id, title] of [
    ['z', 'Same'],
    ['a', 'Same'],
    ['lower', 'same'],
  ]) {
    expect(
      registry.register({
        id: id!,
        title: title!,
        uri: `localix://ui/work-item/${id}/open`,
        effect: 'read',
        surface: 'work-item',
        exposure: {},
        resolve: () => ({ kind: 'work-item', workKind: 'search', id: id!, title: title! }),
      }),
    ).toBe(true)
  }
  const revision = registry.revision()
  expect(registry.search(' SAME ').map((entry) => entry.id)).toEqual(['a', 'z', 'lower'])
  expect(registry.list().map((entry) => entry.id)).toEqual(['z', 'a', 'lower'])
  expect(registry.revision()).toBe(revision)
})

test('empty search retains the default and maximum result counts', () => {
  const registry = createUiLocationRegistry()
  for (let i = 0; i < 22; i++) {
    const id = `item${i}`
    expect(
      registry.register({
        id,
        title: id,
        uri: `localix://ui/work-item/${id}/open`,
        effect: 'read',
        surface: 'work-item',
        exposure: {},
        resolve: () => ({ kind: 'work-item', workKind: 'search', id, title: id }),
      }),
    ).toBe(true)
  }
  expect(registry.search('')).toHaveLength(8)
  expect(registry.search('', { limit: 100 })).toHaveLength(20)
})
