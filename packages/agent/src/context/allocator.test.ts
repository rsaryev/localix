import { describe, expect, it } from 'bun:test'
import { allocate } from './allocator'
import type { Operation } from './op-menu'

const op = (cost: number, retention: number, lossless = false): Operation =>
  ({ cost, retention, lossless }) as unknown as Operation

describe('allocate', () => {
  it('keeps a locked message verbatim (op 0) even when over budget', () => {
    const out = allocate([[op(10, 1), op(2, 0.5)]], [1], 0, new Set([0]))
    expect(out).toEqual([0])
  })

  it('applies no lossy downgrade when already under budget', () => {
    const out = allocate([[op(5, 1), op(2, 0.5)]], [1], 100, new Set())
    expect(out).toEqual([0])
  })

  it('drains a lossless downgrade even under budget (free quality-neutral saving)', () => {
    // op 1 keeps full retention at lower cost → lossless → applied regardless of budget.
    const out = allocate([[op(5, 1), op(2, 1, true)]], [1], 100, new Set())
    expect(out).toEqual([1])
  })

  it('over budget, downgrades the lowest-loss-density message first', () => {
    // Both downgrades save dCost=9. msg0 loses 0.1 value (density ~0.011),
    // msg1 loses 0.9 (density ~0.1) → msg0 is downgraded first; one cut (→cost 11) meets budget 12.
    const out = allocate(
      [
        [op(10, 1), op(1, 0.9)],
        [op(10, 1), op(1, 0.1)],
      ],
      [1, 1],
      12,
      new Set(),
    )
    expect(out).toEqual([1, 0])
  })

  it('drives every unlocked message to its cheapest op when infeasible', () => {
    const out = allocate([[op(10, 1), op(5, 0.5), op(1, 0.1)]], [1], 0, new Set())
    expect(out).toEqual([2])
  })

  it('leaves a single-op (no downgrade) message at verbatim', () => {
    const out = allocate([[op(10, 1)]], [1], 0, new Set())
    expect(out).toEqual([0])
  })
})
