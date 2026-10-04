import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { VF_BRIDGE_KEY, VF_PROTOCOL_VERSION } from '@localixai/visual-feedback/protocol'
import type { VisualFeedbackBridge } from './useVisualFeedback'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})

test('rejects stale channels and settles pending commands when the frame changes', async () => {
  const { act, useRef } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useVisualFeedback } = await import('./useVisualFeedback')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let bridge: VisualFeedbackBridge | undefined
  function Harness() {
    const frame = useRef<HTMLIFrameElement>(null)
    bridge = useVisualFeedback(frame)
    return <iframe ref={frame} title="Preview test" />
  }
  const emit = async (channel: string, payload: Record<string, unknown>) => {
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: host.querySelector('iframe')!.contentWindow,
          data: { ...payload, [VF_BRIDGE_KEY]: channel },
        }),
      )
    })
  }
  try {
    await act(async () => root.render(<Harness />))
    await emit('current', { type: 'ready', channelId: 'current', version: VF_PROTOCOL_VERSION })
    expect(bridge!.connected).toBe(true)
    await emit('old', { type: 'escape' })
    await act(async () => bridge!.setMode('comment'))
    await emit('old', { type: 'escape' })
    expect(bridge!.mode).toBe('comment')
    const reply = bridge!.runCommand('pending', { action: 'snapshot' })
    await act(async () => bridge!.notifyReload())
    expect((await reply).notEngaged).toBe(true)
    expect(bridge!.connected).toBe(false)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
