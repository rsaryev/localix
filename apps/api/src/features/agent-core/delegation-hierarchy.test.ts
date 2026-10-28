import { describe, expect, test } from 'bun:test'

import { delegatesAt, delegationNote } from './delegation-hierarchy'

describe('the delegation depth limit', () => {
  test('only the root conversation delegates', () => {
    expect([0, 1, 2, 3].map(delegatesAt)).toEqual([true, false, false, false])
  })

  test('a subagent is told to do its task itself, without naming a tool it does not have', () => {
    const note = delegationNote(1)
    expect(note).toContain('Do this task yourself')
    expect(note).not.toContain('`Agent`')
  })
})
