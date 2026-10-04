import { describe, expect, test } from 'bun:test'

import type { Message } from './contracts'
import { MODEL_VIEW_DIVIDER_ID, withModelViewDivider } from './modelViewDivider'

const row = (id: string): Message => ({ id, role: 'user', content: id })
const dividers = (messages: readonly Message[]) =>
  messages.filter((message) => message.id === MODEL_VIEW_DIVIDER_ID)

describe('withModelViewDivider', () => {
  test('anchors the line after the last evicted message', () => {
    const out = withModelViewDivider([row('a'), row('b'), row('c')], {
      agentId: 'localix',
      evictedThroughId: 'b',
    })
    expect(dividers(out)).toHaveLength(1)
    expect(dividers(out)[0]!.afterMessageId).toBe('b')
    expect(dividers(out)[0]!.systemNotice?.kind).toBe('context_checkpoint')
  })

  // Only the view in force is true: a trail of old lines would claim the agent sees more.
  test('a newer checkpoint moves the line instead of adding one', () => {
    const first = withModelViewDivider([row('a'), row('b'), row('c')], {
      agentId: 'localix',
      evictedThroughId: 'a',
    })
    const second = withModelViewDivider(first, { agentId: 'localix', evictedThroughId: 'b' })
    expect(dividers(second)).toHaveLength(1)
    expect(dividers(second)[0]!.afterMessageId).toBe('b')
  })

  test('a cleared view removes the line', () => {
    const drawn = withModelViewDivider([row('a')], { agentId: 'localix', evictedThroughId: 'a' })
    expect(dividers(withModelViewDivider(drawn, null))).toHaveLength(0)
  })

  // A detail body is a bounded tail and eviction starts at the head: an anchor the body does
  // not hold lies above everything loaded, never below it.
  test('an anchor outside the loaded tail puts the line first, not last', () => {
    const out = withModelViewDivider([row('x'), row('y')], {
      agentId: 'localix',
      evictedThroughId: 'gone',
    })
    expect(dividers(out)[0]!.afterMessageId).toBeNull()
  })
})
