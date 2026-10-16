import { expect, test } from 'bun:test'
import { outsideTabDragDestination } from './windowTransfer'

const ended = (effect: 'copy' | 'move' | 'none') =>
  ({ dataTransfer: { dropEffect: effect } }) as DragEvent

test('outside drops use native hit testing even when Finder reports an accepted operation', async () => {
  let queries = 0
  const port = {
    available: () => true,
    destination: async () => {
      queries += 1
      return 'window' as const
    },
  }
  for (const effect of ['copy', 'move', 'none'] as const) {
    expect(await outsideTabDragDestination(ended(effect), false, port)).toBe('window')
  }
  expect(queries).toBe(3)
})

test('Escape, a consumed DOM drop, missing dragend, and unsupported platforms never query', async () => {
  let queries = 0
  const port = {
    available: () => true,
    destination: async () => {
      queries += 1
      return 'tab' as const
    },
  }
  expect(await outsideTabDragDestination(ended('none'), true, port)).toBeNull()
  expect(await outsideTabDragDestination(ended('move'), true, port)).toBeNull()
  expect(await outsideTabDragDestination(null, false, port)).toBeNull()
  expect(
    await outsideTabDragDestination(ended('copy'), false, {
      ...port,
      available: () => false,
    }),
  ).toBeNull()
  expect(queries).toBe(0)
})

test('a cursor inside another workspace produces no tear-out', async () => {
  expect(
    await outsideTabDragDestination(ended('none'), false, {
      available: () => true,
      destination: async () => null,
    }),
  ).toBeNull()
})
