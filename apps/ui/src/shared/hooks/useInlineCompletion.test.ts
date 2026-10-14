import { describe, expect, it } from 'bun:test'
import {
  canRequestInlineCompletion,
  inlineCompletionKey,
  INLINE_COMPLETION_MAX_RETRIES,
  planInlineCompletionRetry,
  type InlineCompletionRetryBudget,
  projectInlineCompletion,
  type ResolvedInlineCompletion,
} from './useInlineCompletion'

describe('inlineCompletionKey', () => {
  it('treats the accepted result as a distinct value that can be blocked', () => {
    const before = inlineCompletionKey('session-1', 'chat', 'turn-1', 'Help me')
    const accepted = inlineCompletionKey('session-1', 'chat', 'turn-1', 'Help me with LOCALIX-20.')

    expect(canRequestInlineCompletion(true, accepted, accepted)).toBe(false)
    expect(canRequestInlineCompletion(true, before, accepted)).toBe(true)
    expect(accepted).toBe(
      inlineCompletionKey('session-1', 'chat', 'turn-1', 'Help me with LOCALIX-20.'),
    )
  })

  it('resumes only after a manual edit or context change', () => {
    const blocked = inlineCompletionKey('session-1', 'commit', 'diff-1', 'feat: add search')

    expect(canRequestInlineCompletion(true, blocked, blocked)).toBe(false)
    expect(
      canRequestInlineCompletion(
        true,
        inlineCompletionKey('session-1', 'commit', 'diff-1', 'feat: add search UI'),
        blocked,
      ),
    ).toBe(true)
    expect(
      canRequestInlineCompletion(
        true,
        inlineCompletionKey('session-1', 'commit', 'diff-2', 'feat: add search'),
        blocked,
      ),
    ).toBe(true)
  })

  it('does not collide when user text contains the old key delimiter', () => {
    expect(inlineCompletionKey('a::b', 'commit', 'c', 'd')).not.toBe(
      inlineCompletionKey('a', 'commit', 'b::c', 'd'),
    )
  })
})

describe('projectInlineCompletion', () => {
  const resolved: ResolvedInlineCompletion = {
    key: 'original-key',
    sessionId: 'session-1',
    surface: 'chat',
    contextKey: 'turn-1',
    baseValue: '',
    suffix: 'run the tests',
  }

  it('shrinks the ghost while the user types its matching prefix', () => {
    expect(
      projectInlineCompletion(resolved, {
        sessionId: 'session-1',
        surface: 'chat',
        contextKey: 'turn-1',
        value: 'run',
      }),
    ).toEqual({ covered: true, suggestion: ' the tests' })
  })

  it('keeps the completed target covered without chaining another request', () => {
    expect(
      projectInlineCompletion(resolved, {
        sessionId: 'session-1',
        surface: 'chat',
        contextKey: 'turn-1',
        value: 'run the tests',
      }),
    ).toEqual({ covered: true, suggestion: '' })
  })

  it('invalidates divergent typing and context changes', () => {
    expect(
      projectInlineCompletion(resolved, {
        sessionId: 'session-1',
        surface: 'chat',
        contextKey: 'turn-1',
        value: 'review',
      }).covered,
    ).toBe(false)
    expect(
      projectInlineCompletion(resolved, {
        sessionId: 'session-1',
        surface: 'chat',
        contextKey: 'turn-2',
        value: 'run',
      }).covered,
    ).toBe(false)
  })

  it('never revives text deleted before the original draft', () => {
    expect(
      projectInlineCompletion(
        { ...resolved, baseValue: 'please', suffix: ' run the tests' },
        {
          sessionId: 'session-1',
          surface: 'chat',
          contextKey: 'turn-1',
          value: 'ple',
        },
      ).covered,
    ).toBe(false)
  })
})

describe('planInlineCompletionRetry', () => {
  const key = inlineCompletionKey('s', 'chat', 'ctx', 'draft')

  it('allows a bounded number of attempts for one unchanged draft', () => {
    let budget: InlineCompletionRetryBudget | null = null
    const decisions: boolean[] = []
    for (let attempt = 0; attempt < 5; attempt++) {
      const planned = planInlineCompletionRetry(budget, key)
      budget = planned.budget
      decisions.push(planned.retry)
    }
    // Two extra attempts cover a transient miss; the rest are refused, so an idle
    // focused input stops paying for a model call it has already asked for.
    expect(decisions).toEqual([true, true, false, false, false])
  })

  it('starts over for a different draft, so typing is never locked out', () => {
    let budget: InlineCompletionRetryBudget | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      budget = planInlineCompletionRetry(budget, key).budget
    }
    expect(planInlineCompletionRetry(budget, key).retry).toBe(false)

    const edited = inlineCompletionKey('s', 'chat', 'ctx', 'draft with more')
    const planned = planInlineCompletionRetry(budget, edited)
    expect(planned.retry).toBe(true)
    expect(planned.budget).toEqual({ key: edited, attempts: 1 })
  })

  it('treats a context change as a new draft as well', () => {
    const exhausted = { key, attempts: INLINE_COMPLETION_MAX_RETRIES }
    const afterContextChange = inlineCompletionKey('s', 'chat', 'ctx-2', 'draft')
    expect(planInlineCompletionRetry(exhausted, afterContextChange).retry).toBe(true)
  })

  it('honours an explicit cap, including a cap of zero', () => {
    expect(planInlineCompletionRetry(null, key, 0).retry).toBe(false)
    expect(planInlineCompletionRetry(null, key, 1).retry).toBe(true)
    expect(planInlineCompletionRetry({ key, attempts: 1 }, key, 1).retry).toBe(false)
  })
})
