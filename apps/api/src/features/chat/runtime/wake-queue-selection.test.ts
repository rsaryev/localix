import { describe, expect, test } from 'bun:test'
import type { QueueItem } from '../../../lib/priority-queue'
import { selectDrainBand } from './wake-queue-selection'
import { isBoundaryDeliverable, type PendingTurn } from './wake-queue/leases'

type Turn = { kind: 'user' | 'wake' | 'compact'; bindings?: string[] }

const item = (
  id: string,
  priority: number,
  kind: Turn['kind'],
  bindings?: string[],
): QueueItem<Turn> => ({
  id,
  priority,
  value: { kind, ...(bindings ? { bindings } : {}) },
})

const ids = (items: readonly QueueItem<Turn>[]) => items.map((entry) => entry.id)

describe('selectDrainBand', () => {
  test('different recipients and unaddressed work remain separate FIFO deliveries', () => {
    const routed = (id: string, participant?: string) => ({
      ...item(id, 10, 'wake'),
      value: { kind: 'wake' as const, ...(participant ? { to: { participant } } : {}) },
    })
    const listed = [routed('a', 'agent:a'), routed('b', 'agent:b'), routed('public')]
    expect(ids(selectDrainBand(listed, { durable: false }))).toEqual(['a'])
    expect(ids(selectDrainBand(listed.slice(1), { durable: false }))).toEqual(['b'])
  })
  for (const override of [
    { executionContext: { invocation: { kind: 'channel' }, authority: { capabilities: [] } } },
    { toolSurface: { capabilities: [] } },
    { extraDisabledTools: ['bash'] },
  ]) {
    test(`isolates execution overrides ${Object.keys(override)[0]} in FIFO order`, () => {
      const explicit = {
        ...item('explicit', 10, 'wake'),
        value: { kind: 'wake' as const, ...override },
      }
      const listed = [item('before', 10, 'wake'), explicit, item('after', 10, 'wake', ['image'])]
      expect(ids(selectDrainBand(listed, { durable: false }))).toEqual(['before'])
      expect(ids(selectDrainBand(listed.slice(1), { durable: false }))).toEqual(['explicit'])
      const turn = {
        kind: 'wake',
        internal: true,
        source: 'external',
        userId: 'u',
        content: 'work',
        queuedAt: '2026-09-13T00:00:00Z',
        ...override,
      } as PendingTurn
      expect(isBoundaryDeliverable(turn)).toBe(false)
      expect(isBoundaryDeliverable({ ...turn, kind: 'user' })).toBe(false)
    })
  }

  test('selects the complete highest-priority FIFO band for an in-memory queue', () => {
    const listed = [item('user-a', 0, 'user'), item('user-b', 0, 'user'), item('wake', 10, 'wake')]
    expect(ids(selectDrainBand(listed, { durable: false }))).toEqual(['user-a', 'user-b'])
  })

  test('a bound turn is isolated from otherwise coalescible neighbours', () => {
    const listed = [
      item('plain-a', 10, 'wake'),
      item('bound', 10, 'wake', ['image']),
      item('plain-b', 10, 'wake'),
    ]
    expect(ids(selectDrainBand(listed, { durable: false }))).toEqual(['bound'])
  })

  test('durable delivery checkpoints exactly one row', () => {
    const listed = [item('a', 10, 'wake'), item('b', 10, 'wake')]
    expect(ids(selectDrainBand(listed, { durable: true }))).toEqual(['a'])
  })

  test('promotion selects the exact requested row ahead of normal priority/FIFO order', () => {
    const listed = [item('first', 0, 'user'), item('selected', 10, 'user')]
    expect(ids(selectDrainBand(listed, { durable: false, preferredItemId: 'selected' }))).toEqual([
      'selected',
    ])
  })

  test('a missing preferred id falls back to the normal top band', () => {
    const listed = [item('user', 0, 'user'), item('wake', 10, 'wake')]
    expect(ids(selectDrainBand(listed, { durable: false, preferredItemId: 'missing' }))).toEqual([
      'user',
    ])
  })

  test('an empty queue has no selection', () => {
    expect(selectDrainBand([], { durable: false })).toEqual([])
  })
})
