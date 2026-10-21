import { describe, expect, test } from 'bun:test'
import { refFromToken } from './sendRefs'
import { dismissAllAutoRefs, type AutoRefInput } from './useContextRefs'

describe('clear all ambient context', () => {
  test('dismisses every source tab even when two tabs resolve to the same ref key', () => {
    const ref = refFromToken('@file:src/a.ts')
    expect(ref).not.toBeNull()
    const dismissed: string[] = []
    const autos: AutoRefInput[] = [
      { ref: ref!, dismiss: () => dismissed.push('tab-a') },
      { ref: ref!, dismiss: () => dismissed.push('tab-b') },
    ]

    dismissAllAutoRefs(autos)
    expect(dismissed).toEqual(['tab-a', 'tab-b'])
  })
})
