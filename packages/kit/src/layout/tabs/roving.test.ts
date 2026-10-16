import { describe, expect, test } from 'bun:test'
import { rovingTarget } from './roving'

describe('rovingTarget', () => {
  const items = [{}, { disabled: true }, {}, {}]

  test('arrows step over disabled tabs and wrap at the ends', () => {
    expect(rovingTarget(items, 0, 'ArrowRight')).toBe(2)
    expect(rovingTarget(items, 2, 'ArrowLeft')).toBe(0)
    expect(rovingTarget(items, 3, 'ArrowRight')).toBe(0)
  })

  test('Home/End jump to the first/last enabled tab; other keys are not handled', () => {
    expect(rovingTarget([{ disabled: true }, {}, {}], 2, 'Home')).toBe(1)
    expect(rovingTarget(items, 0, 'End')).toBe(3)
    expect(rovingTarget(items, 0, 'Enter')).toBeNull()
    expect(rovingTarget([{ disabled: true }], 0, 'End')).toBe(-1)
  })
})
