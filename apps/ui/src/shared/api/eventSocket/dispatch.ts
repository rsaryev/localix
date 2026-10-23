import { apiFailure } from '../internal'
import { parseFrame } from '../frameParser'
import { emitRealtimeDiagnostic } from './observers'
import { settlePending } from './refcount'
import { enqueueSessionFrame, restartForResync } from './session-frames'
import { frameHandlers } from './subscription'

/**
 * Route one wire frame to its consumers.
 *
 * Wire frames are newline-delimited text — the server reuses its once-serialized event JSON
 * without re-stringifying:
 *
 *   session: "s\n<boot-epoch>:<sequence>\n<sessionId>\n<event-json>"   (coalesced, see session-frames.ts)
 *   mini app:  "<tag>\n<payload-json>"
 *   rpc:     "r\n{"id","ok","result"|"error","code","status"}"
 *
 * A handler that throws is isolated and reported: one feature's bug must not cost every other
 * consumer the frame.
 */
export function dispatchFrame(raw: string): void {
  const frame = parseFrame(raw)
  if (!frame) return rejectEnvelope(raw)
  if (frame.kind === 'session') {
    enqueueSessionFrame({ cursor: frame.cursor, sessionId: frame.sessionId, json: frame.json })
    return
  }
  if (frame.kind === 'frame') return dispatchExtension(frame.tag, frame.json)
  settleRpcResponse(frame.json)
}

/**
 * A malformed session envelope means the client and server disagree about the realtime
 * contract. Never stay connected while silently discarding the whole chat stream: reconnect and
 * let the authoritative REST reconciliation repair the view.
 */
function rejectEnvelope(raw: string): void {
  const sessionEnvelope = raw.startsWith('s\n')
  emitRealtimeDiagnostic({
    kind: 'frame.envelope.invalid',
    severity: 'error',
    summary: 'Realtime frame was rejected',
    message: sessionEnvelope
      ? 'The connection was restarted to recover the session stream.'
      : 'An invalid realtime frame was ignored.',
    attributes: { channel: sessionEnvelope ? 'session' : 'unknown' },
  })
  if (sessionEnvelope) restartForResync()
}

function dispatchExtension(tag: string, json: string): void {
  const handlers = frameHandlers.get(tag)
  if (!handlers) return
  for (const handler of handlers) {
    try {
      handler(json)
    } catch (err) {
      console.error('[eventSocket] frame handler threw', err)
      emitRealtimeDiagnostic({
        kind: 'handler.extension',
        severity: 'error',
        summary: 'Extension stream handler failed',
        message: 'One extension realtime update could not be applied.',
        attributes: { frameTag: tag },
        error: err,
      })
    }
  }
}

interface RpcResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: string
  code?: string | null
  status?: number
}

function rejectRpcResponse(error?: unknown): void {
  emitRealtimeDiagnostic({
    kind: 'frame.rpc.invalid',
    severity: 'error',
    summary: 'Realtime response was rejected',
    message: 'An invalid RPC response was ignored.',
    ...(error === undefined ? {} : { error }),
  })
}

function settleRpcResponse(json: string): void {
  let msg: RpcResponse
  try {
    msg = JSON.parse(json)
  } catch (error) {
    return rejectRpcResponse(error)
  }
  if (!msg || typeof msg.id !== 'string' || typeof msg.ok !== 'boolean') return rejectRpcResponse()
  const pending = settlePending(msg.id)
  if (!pending) return
  if (msg.ok) pending.resolve(msg.result)
  // Same classification as HTTP: a request that failed over the socket is the same failure to the
  // person who made it, and `Request failed` was never a sentence anyone could act on.
  else pending.reject(apiFailure(msg.error, msg.status ?? 400, msg.code ?? null))
}
