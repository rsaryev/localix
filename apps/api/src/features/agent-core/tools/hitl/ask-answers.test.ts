/**
 * Claude Code's AskUserQuestion takes `answers` from a PreToolUse hook ("supply it via
 * `updatedInput` to answer programmatically", hooks.md): question text → the chosen label, a
 * multi-select's labels comma-joined. Such a call is answered without a card. `answers` is a
 * hook's field, never the model's: the ask tool's schema does not offer it.
 */
import { expect, test } from 'bun:test'
import type { AgentTool } from '@localixai/agent/agents'

import { EMPTY_RUNTIME } from '../../../cc-hooks/runtime-results'
import type { CcHooksRuntime } from '../../../cc-hooks/run'
import { wrapToolsWithCcHooks } from '../../../cc-hooks/wrap-tools'
import { localInputFromHook } from '../../../ext/cc-tool-shapes'
import { askToolInputSchema, createAskTool } from './ask'

const questions = [
  { id: 'lib', question: 'Which library?', options: [{ label: 'date-fns' }, { label: 'dayjs' }] },
  { id: 'why', question: 'Why?', options: [{ label: 'Size' }] },
]

test('a PreToolUse hook’s answers answer the questions, with no card', async () => {
  const updated = { questions, answers: { 'Which library?': 'dayjs', 'Why?': 'It is small' } }
  const runtime = {
    ...EMPTY_RUNTIME,
    active: true,
    runPreToolUse: async () => ({
      decision: 'proceed' as const,
      didRewrite: true,
      updatedInput: localInputFromHook('ask', { questions }, updated),
    }),
  } as CcHooksRuntime
  const logger = { warn: () => {}, info: () => {} }
  const [ask] = wrapToolsWithCcHooks([createAskTool() as unknown as AgentTool], runtime, logger)
  const result = await ask!.execute('a1', { questions }, undefined, undefined, {
    interactive: false,
  } as never)
  expect(result.isError).toBeUndefined()
  expect(result.content).toBe('User answers:\nlib: dayjs\nwhy: It is small')
  expect((result.details as { answers?: unknown }).answers).toEqual([
    { id: 'lib', question: 'Which library?', selectedOptions: ['dayjs'] },
    { id: 'why', question: 'Why?', selectedOptions: [], customInput: 'It is small' },
  ])
})

test('the model cannot answer its own question', () => {
  const parsed = askToolInputSchema.parse({ questions, answers: { 'Why?': 'Size' } })
  expect('answers' in parsed).toBe(false)
})
