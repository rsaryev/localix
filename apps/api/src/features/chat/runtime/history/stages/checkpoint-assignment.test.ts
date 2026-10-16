import { expect, test } from 'bun:test'
import { estimateMessagesTokens, type ChatMessage, type ContextCheckpoint } from '@localixai/agent'

import { resolveContextBudgetFrame } from '../../context-budget'
import { persistedRow } from '../test-fixtures'
import { checkpointStage } from './checkpoint'

test('host provenance carries an internal delegator correction into an evicted epoch card', async () => {
  const rows = [
    persistedRow('task', { role: 'user', content: 'Improve the landing.' }),
    persistedRow('old-answer', { role: 'assistant', content: 'x'.repeat(30_000) }),
    persistedRow('amendment', {
      role: 'user',
      isInternal: true,
      origin: 'delegator',
      content: 'Replace the serif layout with the new reference composition.',
    }),
    persistedRow('amendment-answer', { role: 'assistant', content: 'y'.repeat(30_000) }),
    persistedRow('wake', {
      role: 'user',
      isInternal: true,
      origin: 'subagent',
      content: 'Process finished.',
    }),
    persistedRow('wake-answer', { role: 'assistant', content: 'z'.repeat(30_000) }),
    persistedRow('current', { role: 'user', content: 'Continue and verify.' }),
  ]
  let record: ContextCheckpoint | undefined
  const stage = checkpointStage({
    frame: resolveContextBudgetFrame({ contextWindow: 8_000 }),
    rows,
    due: { hostId: 'next-answer', reason: 'threshold' },
    endsWithTurnContext: false,
    activeInvocationIndex: rows.length - 1,
    flags: { recoveryToolAvailable: true, recallToolAvailable: true },
    onCheckpoint: (checkpoint) => {
      record = checkpoint
    },
  })
  const result = await stage.run(
    rows.map((row) => row.payload),
    {
      budgetTokens: 6_400,
      estimate: (messages) => estimateMessagesTokens(messages as ChatMessage[]),
      signal: new AbortController().signal,
    },
  )
  expect(result.messages[result.messages.length - 1]?.id).toBe('current')
  expect(record?.evictedThroughId).toBeDefined()
  const cards = record!.cards.map((card) => card.text).join('\n')
  expect(cards.toLowerCase()).toContain('assignment update')
  expect(cards).toContain('Replace the serif layout')
  expect(cards).not.toContain('Process finished.')
})
