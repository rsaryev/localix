import { expect, test } from 'bun:test'

import { createSkipAnswerTool } from './skip-answer'

test('skip_answer takes no arguments and ends the turn at once, hidden', async () => {
  const tool = createSkipAnswerTool()
  expect(tool.inputSchema.safeParse({}).success).toBe(true)
  expect(tool.inputSchema.safeParse({ reason: 'x' }).success).toBe(false)
  expect(tool.presentation?.transcript).toBe('hidden')
  expect(await tool.execute('call', {})).toMatchObject({ terminate: true })
})
