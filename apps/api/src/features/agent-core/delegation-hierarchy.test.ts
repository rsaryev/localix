import { describe, expect, test } from 'bun:test'

import { delegatesAt, delegationNote } from './delegation-hierarchy'

describe('the delegation depth limit', () => {
  test('only the root conversation delegates', () => {
    expect([0, 1, 2, 3].map(delegatesAt)).toEqual([true, false, false, false])
  })

  test('a delegated child is told to do its task itself, without naming a removed tool', () => {
    const note = delegationNote(1)
    expect(note).toContain('cannot be delegated again')
    expect(note).not.toContain('`agents`')
  })
})
