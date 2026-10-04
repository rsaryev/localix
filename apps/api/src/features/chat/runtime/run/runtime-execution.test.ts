import { expect, test } from 'bun:test'

import {
  buildRequiredConversationControlFollowUp,
  requiresConversationControl,
} from './runtime-execution'

test('turn control is required only where it is offered, and only with company', () => {
  const withTool = [{ name: 'bash' }, { name: 'conversation_control' }]
  expect(requiresConversationControl(2, withTool)).toBe(true)
  expect(requiresConversationControl(1, withTool)).toBe(false)
  // A multi-member run that was never handed the tool cannot be failed for not calling it.
  expect(requiresConversationControl(3, [{ name: 'bash' }])).toBe(false)
})

test('multi-agent protocol repairs an omitted conversation_control but stops after completion', async () => {
  let completed = false
  let reminders = 0
  const followUp = buildRequiredConversationControlFollowUp(
    () => completed,
    () => reminders++,
  )
  expect(await followUp()).toHaveLength(1)
  expect(reminders).toBe(1)
  completed = true
  expect(await followUp()).toEqual([])
  expect(reminders).toBe(1)
})
