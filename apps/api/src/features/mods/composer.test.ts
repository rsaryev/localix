import { expect, test } from 'bun:test'
import { createModComposer } from './composer'

test('a conversation’s box takes each fill once, keeps one suggestion, and a status per mod', () => {
  let pokes = 0
  const composer = createModComposer(() => pokes++)
  const first = composer.fill('s1', '> quote', 'insert')
  composer.fill('s1', 'draft', 'sideways')
  composer.suggest('s1', 'run the tests')
  composer.status('s1', 'diff', '+3 −1')
  composer.status('s1', 'lint', 'clean')
  expect(pokes).toBe(5)

  const view = composer.view('s1')
  expect(view.fills.map(({ text, mode }) => [text, mode])).toEqual([
    ['> quote', 'insert'],
    ['draft', 'replace'],
  ])
  expect(view.suggestion).toBe('run the tests')
  expect(view.statuses).toEqual({ diff: '+3 −1', lint: 'clean' })
  expect(composer.view('s2')).toEqual({ fills: [], suggestion: null, statuses: {} })

  composer.take('s1', { fills: [first.id], suggestion: true })
  composer.status('s1', 'lint', undefined)
  composer.forget('diff')
  expect(composer.view('s1')).toEqual({
    fills: [expect.objectContaining({ text: 'draft' })],
    suggestion: null,
    statuses: {},
  })
})
