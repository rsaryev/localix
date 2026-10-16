import { describe, expect, test } from 'bun:test'

import { isHitlReachable } from './hitl-reachable'

describe('isHitlReachable', () => {
  test('a chat session reaches its own surface', () => {
    expect(
      isHitlReachable({ sessionKind: 'chat', sessionId: 's1', hitlTargetSessionId: 's1' }),
    ).toBe(true)
  })

  test('a sub-agent under a chat root IS reachable — its prompt surfaces in that chat', () => {
    // The regression this guards: keying off `sessionKind === 'chat'` would deny a
    // sub-agent a prompt the user would in fact have seen (event-handlers-hitl.ts
    // retitles it and publishes it to the root chat).
    expect(
      isHitlReachable({ sessionKind: 'subagent', sessionId: 'child', hitlTargetSessionId: 'root' }),
    ).toBe(true)
  })

  test('a null target is unreachable for every session kind', () => {
    for (const sessionKind of ['chat', 'subagent', 'job', 'system']) {
      expect(isHitlReachable({ sessionKind, sessionId: 's1', hitlTargetSessionId: null })).toBe(
        false,
      )
    }
  })

  test('a parentless automation job resolving to itself is unreachable', () => {
    expect(
      isHitlReachable({ sessionKind: 'job', sessionId: 'j1', hitlTargetSessionId: 'j1' }),
    ).toBe(false)
    // …but a PARENTED job routes to its verified root chat.
    expect(
      isHitlReachable({ sessionKind: 'job', sessionId: 'j1', hitlTargetSessionId: 'root' }),
    ).toBe(true)
  })

  test('a system session whose root is a chat is reachable', () => {
    expect(
      isHitlReachable({ sessionKind: 'system', sessionId: 's2', hitlTargetSessionId: 'root' }),
    ).toBe(true)
  })
})
