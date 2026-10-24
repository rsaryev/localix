/**
 * Claude Code's AskUserQuestion takes `answers` from a PreToolUse hook ("supply it via
 * `updatedInput` to answer programmatically", hooks.md): question text → the chosen label, a
 * multi-select's labels comma-joined. Such a call is answered without a card.
 */
import { expect, test } from 'bun:test'

import { localInputFromHook } from '../../../ext/cc-tool-shapes'
import { createAskTool } from './ask'

const questions = [
  { id: 'lib', question: 'Which library?', options: [{ label: 'date-fns' }, { label: 'dayjs' }] },
  { id: 'why', question: 'Why?', options: [{ label: 'Size' }] },
]

test('a hook’s answers answer the questions, with no card', async () => {
  const updated = { questions, answers: { 'Which library?': 'dayjs', 'Why?': 'It is small' } }
  const input = localInputFromHook('ask', { questions }, updated) as never
  const result = await createAskTool().execute('a1', input, undefined, undefined, {
    interactive: false,
  } as never)
  expect(result.isError).toBeUndefined()
  expect(result.content).toBe('User answers:\nlib: dayjs\nwhy: It is small')
  expect(result.details?.answers).toEqual([
    { id: 'lib', question: 'Which library?', selectedOptions: ['dayjs'] },
    { id: 'why', question: 'Why?', selectedOptions: [], customInput: 'It is small' },
  ])
})
