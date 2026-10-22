import { expect, test } from 'bun:test'
import type { InlineCompletionController } from '@/shared/hooks/useInlineCompletion'
import { offeredCompletion } from './useChatInlineCompletion'

const base: InlineCompletionController = {
  suggestion: '',
  accept: () => false,
  dismiss: () => false,
  request: () => false,
  handleCompositionStart: () => {},
  handleCompositionEnd: () => {},
  handleKeyDown: () => false,
}

const key = (name: string) =>
  ({ key: name, shiftKey: false, preventDefault: () => {} }) as unknown as React.KeyboardEvent

test('an offered suggestion is the empty box’s ghost: Tab writes it, Escape lets it go', () => {
  const written: string[] = []
  let settled = 0
  const offered = { text: 'run the tests', settle: () => settled++ }
  const ghost = offeredCompletion(offered, base, (value) => written.push(value))
  expect(ghost.suggestion).toBe('run the tests')
  expect(ghost.handleKeyDown(key('Tab'))).toBe(true)
  expect(written).toEqual(['run the tests'])
  expect(ghost.handleKeyDown(key('Escape'))).toBe(true)
  expect(settled).toBe(2)
  expect(ghost.handleKeyDown(key('a'))).toBe(false)
})
