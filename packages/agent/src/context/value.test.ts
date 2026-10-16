import { describe, expect, test } from 'bun:test'
import { messageValue, scoreMessages, DEFAULT_VALUE_WEIGHTS, type ValueWeights } from './value'
import type { ChatMessage } from '../chat'
import type { DepGraph } from './dep-graph'

const msg = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ role, content }) as ChatMessage
// Stub graph with controllable scores (default: no dependency, not superseded).
const graph = (
  dep: (i: number) => number = () => 0,
  sup: (i: number) => number = () => 0,
): DepGraph => ({
  depScore: dep,
  supersededScore: sup,
})

describe('messageValue', () => {
  test('the first user message gets the firstTaskBonus', () => {
    const msgs = [msg('user', 'do X'), msg('assistant', 'ok')]
    const v0 = messageValue(0, msgs, graph())
    expect(v0).toBeGreaterThan(DEFAULT_VALUE_WEIGHTS.firstTaskBonus) // bonus + recency
  })

  test('an assistant message at index 0 gets NO firstTaskBonus', () => {
    const asUser = messageValue(0, [msg('user', 'hi'), msg('assistant', 'x')], graph())
    const asAsst = messageValue(0, [msg('assistant', 'hi'), msg('assistant', 'x')], graph())
    expect(asUser - asAsst).toBeCloseTo(DEFAULT_VALUE_WEIGHTS.firstTaskBonus, 5)
  })

  test('decision/constraint language adds the decisionBonus', () => {
    const plain = messageValue(1, [msg('user', 'a'), msg('assistant', 'sure thing')], graph())
    const decision = messageValue(
      1,
      [msg('user', 'a'), msg('assistant', 'we must never delete prod')],
      graph(),
    )
    expect(decision - plain).toBeCloseTo(DEFAULT_VALUE_WEIGHTS.decisionBonus, 5)
  })

  test('decision language inside a structured text item also earns the bonus', () => {
    // Tool-using turns carry prose in `items`, not string `content`.
    const itemMsg = (text: string): ChatMessage =>
      ({
        role: 'assistant',
        content: null,
        items: [{ id: 't1', type: 'text', text }],
      }) as unknown as ChatMessage
    const plain = messageValue(1, [msg('user', 'a'), itemMsg('sure thing')], graph())
    const decision = messageValue(
      1,
      [msg('user', 'a'), itemMsg('we must never delete prod')],
      graph(),
    )
    expect(decision - plain).toBeCloseTo(DEFAULT_VALUE_WEIGHTS.decisionBonus, 5)
  })

  test('error content adds wError', () => {
    const ok = messageValue(1, [msg('user', 'a'), msg('assistant', 'done')], graph())
    const err = messageValue(
      1,
      [msg('user', 'a'), msg('assistant', 'the build failed with an exception')],
      graph(),
    )
    expect(err - ok).toBeCloseTo(DEFAULT_VALUE_WEIGHTS.wError, 5)
  })

  test('superseded observations subtract value but never below epsilon', () => {
    const msgs = [msg('user', 'a'), msg('assistant', 'b')]
    const heavilySuperseded = messageValue(
      1,
      msgs,
      graph(
        () => 0,
        () => 100,
      ),
    )
    expect(heavilySuperseded).toBe(DEFAULT_VALUE_WEIGHTS.epsilon) // clamped to the floor
  })

  test('recency: a later message scores higher than an earlier one, all else equal', () => {
    const msgs = [msg('assistant', 'x'), msg('assistant', 'y'), msg('assistant', 'z')]
    const g = graph()
    expect(messageValue(2, msgs, g)).toBeGreaterThan(messageValue(0, msgs, g))
  })

  test('depScore is weighted by wDep', () => {
    const msgs = [msg('user', 'a'), msg('assistant', 'b')]
    const base = messageValue(
      0,
      msgs,
      graph(() => 0),
    )
    const depended = messageValue(
      0,
      msgs,
      graph(() => 1),
    )
    expect(depended - base).toBeCloseTo(DEFAULT_VALUE_WEIGHTS.wDep, 5)
  })
})

describe('scoreMessages', () => {
  test('scores every message in order', () => {
    const msgs = [msg('user', 'a'), msg('assistant', 'b'), msg('assistant', 'c')]
    const scores = scoreMessages(msgs, graph())
    expect(scores).toHaveLength(3)
    expect(scores.every((s) => s >= DEFAULT_VALUE_WEIGHTS.epsilon)).toBe(true)
  })

  test('honors custom weights', () => {
    const msgs = [msg('user', 'a'), msg('assistant', 'b')]
    const weights: ValueWeights = { ...DEFAULT_VALUE_WEIGHTS, firstTaskBonus: 0 }
    const score0 = scoreMessages(msgs, graph(), weights)[0]
    // With no first-task bonus, index 0 is just its recency term (dep/error/superseded = 0).
    expect(score0).toBeLessThan(DEFAULT_VALUE_WEIGHTS.firstTaskBonus)
  })
})
