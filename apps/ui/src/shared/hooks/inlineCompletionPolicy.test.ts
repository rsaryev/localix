import { describe, expect, it } from 'bun:test'
import {
  inlineCompletionAcceptance,
  inlineCompletionKey,
  projectInlineCompletionDelivery,
  shouldRetryInlineCompletion,
} from './inlineCompletionPolicy'

describe('retry classification', () => {
  it('never retries a cancellation, including a supersede that carries no code', () => {
    const abort = Object.assign(new Error('Realtime request was aborted'), { name: 'AbortError' })
    expect(shouldRetryInlineCompletion(abort)).toBe(false)
    for (const code of ['cancelled', 'disabled', 'no_model'])
      expect(shouldRetryInlineCompletion(Object.assign(new Error(code), { code }))).toBe(false)
  })

  it('retries transient server outcomes and transport failures', () => {
    for (const code of ['timeout', 'error', 'ws_timeout'])
      expect(shouldRetryInlineCompletion(Object.assign(new Error(code), { code }))).toBe(true)
    expect(shouldRetryInlineCompletion(new Error('Inline completion unavailable'))).toBe(true)
  })
})

describe('late completion delivery', () => {
  const key = (draft: string, context = 'revision1') =>
    inlineCompletionKey('session', 'chat', context, draft)

  it('reuses an answer when the user typed its exact prefix before delivery', () => {
    expect(projectInlineCompletionDelivery(key('com'), key('comple'), 'pletion')).toEqual({
      baseValue: 'comple',
      suffix: 'tion',
    })
  })

  it('rejects divergent text, changed context and malformed keys', () => {
    expect(projectInlineCompletionDelivery(key('com'), key('compare'), 'pletion')).toBeNull()
    expect(
      projectInlineCompletionDelivery(key('com'), key('com', 'revision2'), 'pletion'),
    ).toBeNull()
    expect(projectInlineCompletionDelivery('broken', key('com'), 'pletion')).toBeNull()
  })
})

describe('partial acceptance', () => {
  it('preserves insertion whitespace and accepts a word or line', () => {
    expect(inlineCompletionAcceptance(' next word', 'word')).toBe(' next ')
    expect(inlineCompletionAcceptance('line one\nline two', 'line')).toBe('line one\n')
    expect(inlineCompletionAcceptance('pletion', 'word')).toBe('pletion')
  })
})
