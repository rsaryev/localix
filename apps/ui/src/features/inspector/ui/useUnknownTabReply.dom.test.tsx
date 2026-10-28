import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { backendClient } from '@/shared/api/client'
import { previewControlBus } from '@/shared/lib/previewControlBus'
import { usePreviewStore } from '../model/previewStore'
import { useUnknownTabReply } from './useUnknownTabReply'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>
const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let previousAct: boolean | undefined
beforeAll(() => {
  teardown = registerDom()
  previousAct = globals.IS_REACT_ACT_ENVIRONMENT
  globals.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  globals.IS_REACT_ACT_ENVIRONMENT = previousAct
  await teardown()
})

function Host() {
  useUnknownTabReply(0)
  return null
}

// An invented tab ID ("fead2cc2…b2b8b2b8") waited out the relay and came back as
// host_unavailable, which read as a broken app rather than a wrong ID.
test('a command for a tab ID nothing hosts is answered with the open tabs', async () => {
  const before = usePreviewStore.getState()
  const sessionId = 'unknown-tab-session'
  const tab = {
    previewId: 'fead2cc220444b2b8cd964047fa087cf',
    url: 'http://127.0.0.1:4173/',
    version: 1,
  }
  usePreviewStore.setState({
    previewBySession: { [sessionId]: tab },
    previewTabsBySession: { [sessionId]: [tab] },
  })
  const replies: Array<{ id: string; payload: Record<string, unknown> }> = []
  const reply = spyOn(backendClient, 'previewResult').mockImplementation(async (id, payload) => {
    replies.push({ id, payload })
    return true
  })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Host />))
    await act(async () => {
      previewControlBus.publish({
        sessionId,
        commandId: 'known',
        command: { action: 'snapshot', previewId: tab.previewId },
      })
      previewControlBus.publish({
        sessionId,
        commandId: 'invented',
        command: {
          action: 'evaluate',
          previewId: 'fead2cc220444b2b8b2b8b2b8b2b8b2b',
          expression: '1',
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      await turns()
    })
    expect(replies.some((r) => r.id === 'known')).toBe(false)
    const answered = replies.filter((r) => r.id === 'invented').map((r) => r.payload)
    expect(answered[0]).toMatchObject({ claim: true })
    expect(answered[1]).toMatchObject({ ok: false, errorCode: 'not_found' })
    expect(String(answered[1]?.error)).toContain(`${tab.previewId} — ${tab.url}`)
  } finally {
    await act(async () => root.unmount())
    reply.mockRestore()
    previewControlBus.acknowledge('known')
    usePreviewStore.setState({
      previewBySession: before.previewBySession,
      previewTabsBySession: before.previewTabsBySession,
    })
  }
})
