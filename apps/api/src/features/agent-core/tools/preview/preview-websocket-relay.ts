// WebSocket transport for preview HMR: bounded queues and backpressure in both directions.

/** Per-connection relay state carried on a proxied HMR WebSocket. */
export interface WsRelay {
  /** Upstream dev-server ws:// URL this browser socket is bridged to. */
  target: string
  /** The proxy's own origin, sent upstream so the dev server can still judge the handshake. */
  origin: string
  /** Negotiated subprotocol echoed from the browser (e.g. Vite's `vite-hmr`). */
  protocol?: string
  /** Client socket to the upstream dev server (created on `open`). */
  upstream?: WebSocket
  /** Browser→upstream messages received before the upstream socket is open. */
  queue: (string | ArrayBuffer | Uint8Array)[]
  /** Exact UTF-8/binary bytes retained in {@link queue}. */
  queueBytes: number
}

export const PREVIEW_WS_MAX_QUEUED_FRAMES = 128
export const PREVIEW_WS_MAX_BUFFERED_BYTES = 1024 * 1024
const PREVIEW_WS_BACKPRESSURE_CLOSE_CODE = 1013
const PREVIEW_WS_BACKPRESSURE_REASON = 'Preview relay backpressure'

type PreviewWsMessage = string | ArrayBuffer | Uint8Array

export function previewWsMessageBytes(message: PreviewWsMessage): number {
  return typeof message === 'string'
    ? new TextEncoder().encode(message).byteLength
    : message.byteLength
}

/**
 * Send immediately when the upstream can accept the frame, otherwise retain a
 * strictly bounded pre-connect queue. `false` asks the caller to close both ends.
 */
export function sendOrQueuePreviewWsMessage(relay: WsRelay, message: PreviewWsMessage): boolean {
  const bytes = previewWsMessageBytes(message)
  if (bytes > PREVIEW_WS_MAX_BUFFERED_BYTES) return false
  const upstream = relay.upstream
  if (upstream?.readyState === WebSocket.OPEN) {
    if (upstream.bufferedAmount + bytes > PREVIEW_WS_MAX_BUFFERED_BYTES) return false
    upstream.send(message as unknown as ArrayBuffer)
    return true
  }
  if (
    relay.queue.length >= PREVIEW_WS_MAX_QUEUED_FRAMES ||
    relay.queueBytes + bytes > PREVIEW_WS_MAX_BUFFERED_BYTES
  ) {
    return false
  }
  relay.queue.push(message)
  relay.queueBytes += bytes
  return true
}

function closeBackpressuredRelay(ws: Bun.ServerWebSocket<WsRelay>): void {
  try {
    ws.data.upstream?.close(PREVIEW_WS_BACKPRESSURE_CLOSE_CODE, PREVIEW_WS_BACKPRESSURE_REASON)
  } catch {
    /* already closing */
  }
  try {
    ws.close(PREVIEW_WS_BACKPRESSURE_CLOSE_CODE, PREVIEW_WS_BACKPRESSURE_REASON)
  } catch {
    /* already closing */
  }
}

/** Bridge a browser HMR socket ⇄ the upstream dev server. The upstream client socket is
 *  opened lazily on `open`; browser messages that arrive before it connects are queued
 *  and flushed once it does. */
export const websocketRelay: Bun.WebSocketHandler<WsRelay> = {
  open(ws) {
    const relay = ws.data
    // Bun's client socket sends no Origin by default, which an upstream reads as a trusted
    // non-browser client. Name the page origin the handshake came from instead.
    // (Bun's client takes an options object; the DOM typing in scope only knows protocols.)
    const options: Bun.WebSocketOptions = {
      headers: { origin: relay.origin },
      ...(relay.protocol ? { protocols: relay.protocol.split(',').map((p) => p.trim()) } : {}),
    }
    const up = new WebSocket(relay.target, options as unknown as string[])
    up.binaryType = 'arraybuffer'
    relay.upstream = up
    up.addEventListener('open', () => {
      // `send` accepts string | BufferSource; Bun's Buffer is typed over the wider
      // ArrayBufferLike, so cast at the boundary (the value is always wire-sendable).
      for (const m of relay.queue) {
        const bytes = previewWsMessageBytes(m)
        if (up.bufferedAmount + bytes > PREVIEW_WS_MAX_BUFFERED_BYTES) {
          closeBackpressuredRelay(ws)
          return
        }
        up.send(m as unknown as ArrayBuffer)
      }
      relay.queue.length = 0
      relay.queueBytes = 0
    })
    up.addEventListener('message', (e) => {
      const message = e.data as PreviewWsMessage
      if (ws.getBufferedAmount() + previewWsMessageBytes(message) > PREVIEW_WS_MAX_BUFFERED_BYTES) {
        closeBackpressuredRelay(ws)
        return
      }
      ws.send(message)
    })
    up.addEventListener('close', () => ws.close())
    up.addEventListener('error', () => {
      try {
        ws.close()
      } catch {
        /* already closing */
      }
    })
  },
  message(ws, message) {
    if (!sendOrQueuePreviewWsMessage(ws.data, message)) closeBackpressuredRelay(ws)
  },
  close(ws) {
    try {
      ws.data.upstream?.close()
    } catch {
      /* already closed */
    }
  },
}
