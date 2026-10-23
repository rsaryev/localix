import { describe, expect, test } from 'bun:test'

import {
  PREVIEW_WS_MAX_BUFFERED_BYTES,
  PREVIEW_WS_MAX_QUEUED_FRAMES,
  previewWsMessageBytes,
  sendOrQueuePreviewWsMessage,
} from './preview-websocket-relay'

type Relay = Parameters<typeof sendOrQueuePreviewWsMessage>[0]

function relay(): Relay {
  return { target: 'ws://localhost', origin: 'http://localhost', queue: [], queueBytes: 0 }
}

describe('preview websocket relay backpressure', () => {
  test('measures strings as UTF-8 bytes', () => {
    expect(previewWsMessageBytes('abc')).toBe(3)
    expect(previewWsMessageBytes('😀')).toBe(4)
  })

  test('bounds both pre-connect frame count and retained bytes', () => {
    const byCount = relay()
    for (let i = 0; i < PREVIEW_WS_MAX_QUEUED_FRAMES; i += 1) {
      expect(sendOrQueuePreviewWsMessage(byCount, 'x')).toBe(true)
    }
    expect(sendOrQueuePreviewWsMessage(byCount, 'overflow')).toBe(false)
    expect(byCount.queue).toHaveLength(PREVIEW_WS_MAX_QUEUED_FRAMES)

    const byBytes = relay()
    expect(sendOrQueuePreviewWsMessage(byBytes, 'x'.repeat(PREVIEW_WS_MAX_BUFFERED_BYTES))).toBe(
      true,
    )
    expect(sendOrQueuePreviewWsMessage(byBytes, 'x')).toBe(false)
    expect(byBytes.queueBytes).toBe(PREVIEW_WS_MAX_BUFFERED_BYTES)
  })

  test('refuses to grow an already backpressured upstream socket', () => {
    const sent: unknown[] = []
    const state = relay()
    state.upstream = {
      readyState: WebSocket.OPEN,
      bufferedAmount: PREVIEW_WS_MAX_BUFFERED_BYTES - 2,
      send(message: unknown) {
        sent.push(message)
      },
    } as unknown as WebSocket

    expect(sendOrQueuePreviewWsMessage(state, 'ok')).toBe(true)
    expect(sendOrQueuePreviewWsMessage(state, 'too large')).toBe(false)
    expect(sent).toEqual(['ok'])
  })
})
