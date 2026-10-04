import { afterEach, test, expect, describe } from 'bun:test'
import { createProbeTransport } from './postmessage'
import { VF_BRIDGE_KEY } from '../protocol/index'

/**
 * The probe runs INSIDE a live preview page — any script in that page (or a nested
 * iframe, or another window) can `postMessage` at it. `createProbeTransport` is the
 * ONLY cross-realm trust boundary, and it is not origin-based (the preview is served
 * from an unpredictable ephemeral port). Trust rests on TWO gates, both of which must
 * fail CLOSED (drop the message) on their degenerate input:
 *   1. the per-instance channel nonce (`__vf`) — absent/wrong ⇒ drop;
 *   2. `event.source === parent` — any other window ⇒ drop.
 *
 * A host command that slips past these reaches the command switch in `entry.ts`, so a
 * gate that failed OPEN would let a hostile in-page script drive the probe. These tests
 * redden if either gate is loosened. (No DOM in Bun — a minimal fake `window` collects
 * the `message` listener and lets us dispatch synthetic events with a chosen `.source`.)
 */

/**
 * `fakeWindow` installs a global `window`, and this file used to leave it there. `bun test`
 * shares one process across files and does NOT run them in the order they are passed, so that
 * fake outlived this file and any later test asserting "there is no window" failed — the pure
 * `getDesktopApiPort` suite in `apps/ui` did, but only when `packages` was in the same run, and
 * never on its own. The whole full-suite run was untrustworthy because of it.
 */
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

function fakeWindow() {
  const listeners: ((e: unknown) => void)[] = []
  const w = {
    addEventListener: (type: string, h: (e: unknown) => void) => {
      if (type === 'message') listeners.push(h)
    },
    removeEventListener: (type: string, h: (e: unknown) => void) => {
      const i = listeners.indexOf(h)
      if (i >= 0) listeners.splice(i, 1)
    },
    parent: { postMessage() {} },
  }
  ;(globalThis as { window?: unknown }).window = w
  return {
    dispatch: (e: unknown) => listeners.slice().forEach((h) => h(e)),
    listenerCount: () => listeners.length,
  }
}

describe('createProbeTransport — cross-realm trust gates', () => {
  test('drops null data, a missing nonce, a wrong nonce, and a wrong source', () => {
    const { dispatch } = fakeWindow()
    const target = { postMessage() {} } as unknown as Window
    const transport = createProbeTransport(target)
    const received: unknown[] = []
    transport.onHost((m) => received.push(m))

    const good = { type: 'ping', [VF_BRIDGE_KEY]: transport.channelId }

    // ZERO input for gate 1 (nonce):
    dispatch({ data: null, source: target }) // null message body
    dispatch({ data: { type: 'ping' }, source: target }) // nonce absent
    dispatch({ data: { type: 'ping', [VF_BRIDGE_KEY]: 'vf_forged' }, source: target }) // nonce wrong
    // ZERO input for gate 2 (source): a different window, even WITH the correct nonce.
    dispatch({ data: good, source: { impostor: true } })

    expect(received).toHaveLength(0)
  })

  test('accepts a message that satisfies BOTH gates', () => {
    const { dispatch } = fakeWindow()
    const target = { postMessage() {} } as unknown as Window
    const transport = createProbeTransport(target)
    const received: unknown[] = []
    transport.onHost((m) => received.push(m))

    dispatch({ data: { type: 'ping', [VF_BRIDGE_KEY]: transport.channelId }, source: target })

    expect(received).toHaveLength(1)
    expect((received[0] as { type: string }).type).toBe('ping')
  })

  test('destroy() unhooks the listener so no later message is delivered', () => {
    const { dispatch, listenerCount } = fakeWindow()
    const target = { postMessage() {} } as unknown as Window
    const transport = createProbeTransport(target)
    const received: unknown[] = []
    transport.onHost((m) => received.push(m))

    transport.destroy()
    expect(listenerCount()).toBe(0)
    dispatch({ data: { type: 'ping', [VF_BRIDGE_KEY]: transport.channelId }, source: target })
    expect(received).toHaveLength(0)
  })
})
