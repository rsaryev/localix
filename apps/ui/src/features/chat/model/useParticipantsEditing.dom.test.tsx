import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ConversationMode } from '@localixai/api/conversation-modes'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
// `backendClient` is one process-wide object: a spy left on it is read by the next file.
afterAll(async () => {
  mock.restore()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const route = (agentId: string) => ({
  agentId,
  handle: agentId,
  providerConnectionId: null,
  modelId: '',
  reasoningEffort: 'medium' as const,
})

async function addTo(mode: ConversationMode) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const { useParticipantsEditing } = await import('./useParticipantsEditing')
  const sent: unknown[] = []
  const update = spyOn(backendClient, 'updateSession').mockImplementation(async (_id, patch) => {
    sent.push(patch)
    throw new Error('not under test')
  })
  let add: ((agentId: string) => void) | undefined
  function Probe() {
    add = useParticipantsEditing('s1', [route('lead')], mode).addParticipant
    return null
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  await React.act(async () => root.render(<Probe />))
  await React.act(async () => {
    add!('qa')
    await settle()
  })
  await React.act(async () => root.unmount())
  update.mockRestore()
  return sent
}

/**
 * Solo is one agent, so a person adding a participant to a solo chat makes it a group — in the
 * SAME edit. Sent as two requests, the membership one would meet a solo conversation and be
 * refused, or the mode one would land after the agent had already answered as if alone.
 */
test('adding to a solo chat sends the membership and the group mode as one edit', async () => {
  expect(await addTo('solo')).toEqual([{ agentIds: ['lead', 'qa'], conversationMode: 'group' }])
})

test('adding to a group sends only the membership', async () => {
  expect(await addTo('group')).toEqual([{ agentIds: ['lead', 'qa'] }])
})
