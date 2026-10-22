import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { VF_BRIDGE_KEY, VF_PROTOCOL_VERSION } from '@localixai/visual-feedback/protocol'
import type { VisualFeedbackBridge } from './useVisualFeedback'

// happy-dom loads no iframe page, so a frame has a window only from `srcdoc`, where a browser
// gives every frame one (`about:blank`).
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
    return <iframe ref={frame} srcDoc="" title="Preview test" />
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
    // The page reloads itself mid-command: its new probe's handshake settles the command.
    const reloaded = bridge!.runCommand('reloading', { action: 'snapshot' })
    await emit('next', { type: 'ready', channelId: 'next', version: VF_PROTOCOL_VERSION })
    expect(await reloaded).toMatchObject({ ok: false, error: 'The page reloaded before replying.' })
    expect(bridge!.connected).toBe(true)
    const reply = bridge!.runCommand('pending', { action: 'snapshot' })
    await act(async () => bridge!.notifyReload())
    expect((await reply).notEngaged).toBe(true)
    expect(bridge!.connected).toBe(false)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('a comment being written survives a page reload, and a commented element opens its comment', async () => {
  const { act, useRef } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useVisualFeedback } = await import('./useVisualFeedback')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let bridge: VisualFeedbackBridge | undefined
  const posted: Array<Record<string, unknown>> = []
  function Harness() {
    const frame = useRef<HTMLIFrameElement>(null)
    bridge = useVisualFeedback(frame)
    return <iframe ref={frame} srcDoc="" title="Preview reload test" />
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
  const rect = { x: 0, y: 0, width: 10, height: 10 }
  const capture = { kind: 'element', summary: 'Title', selector: '#title', rect }
  try {
    await act(async () => root.render(<Harness />))
    const frame = host.querySelector('iframe')!.contentWindow!
    frame.postMessage = ((message: Record<string, unknown>) => posted.push(message)) as never
    await emit('one', { type: 'ready', channelId: 'one', version: VF_PROTOCOL_VERSION })
    await emit('one', { type: 'selected', capture })
    expect(bridge!.pending?.capture.selector).toBe('#title')

    await act(async () => bridge!.notifyReload())
    await emit('two', { type: 'ready', channelId: 'two', version: VF_PROTOCOL_VERSION })
    expect(bridge!.pending?.capture.selector).toBe('#title')
    expect(posted.at(-1)).toMatchObject({ type: 'reveal', selector: '#title' })

    await emit('two', { type: 'open-mark', id: 'c1', rect })
    expect(bridge!.openedMark).toEqual({ id: 'c1', rect })
    expect(bridge!.pending).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
