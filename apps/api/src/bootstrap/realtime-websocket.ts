import type { WebSocketHandler } from 'bun'
import { MAX_MESSAGE_BINDINGS_TOTAL_BYTES } from '../features/chat/contracts'
import { websocket } from '../features/realtime/ws'

// Bun CLOSES a socket that receives a frame above `maxPayloadLength` (default
// 16MB) — but a `{t:'send'}` RPC legitimately carries up to
// MAX_MESSAGE_BINDINGS_TOTAL_BYTES (~25MB) of inline binding payloads, so the
// default would kill the tab's whole multiplexed firehose on a contract-valid
// send. ×2 headroom covers JSON/prompt overhead. Set HERE, once, so every host
// (index.ts, the desktop shell) inherits the same cap via `runtime.websocket`.
// (Annotated with Bun's own handler type — hono/bun's inferred type isn't
// portable in the emitted declarations, TS2883.)
export const realtimeWebSocket: WebSocketHandler<unknown> = {
  ...(websocket as unknown as WebSocketHandler<unknown>),
  maxPayloadLength: 2 * MAX_MESSAGE_BINDINGS_TOTAL_BYTES,
}
