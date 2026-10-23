import { makeAbortError } from '@localixai/agent'

import { ApiError } from '../internal'
import { emitRpcRequestEvent } from './observers'
import { pendingRequests, release, settlePending } from './refcount'
import { conn, isOpen } from './state'
import { retain } from './transport'

/**
 * Client→server RPC over the same socket (send message, HITL respond/dismiss…). Each request
 * carries a correlation id; the server replies with an `r` frame that `dispatch.ts` settles.
 */

const REQUEST_TIMEOUT_MS = 30_000

// Cancellation is matched by NAME (`error.name === 'AbortError'`), never by class — so the
// shape is minted by its owner, `makeAbortError` in @localixai/agent, rather than re-typed
// here as a `DOMException` literal. That literal was an invisible coupling: the agent
// loop's `classifyAgentError` decides cancel-vs-fatal off that exact string, nothing
// type-checks it, and a drift on either side silently turns a user's Stop into a fatal
// error. The owner returns a plain `Error`, which satisfies every consumer of these
// rejections (all catch generically; no `instanceof DOMException` check exists anywhere).
const ABORT_MESSAGE = 'Realtime request was aborted'

const RPC_ATTRIBUTE_KEYS = [
  'sessionId',
  'toolCallId',
  'terminalId',
  'requestId',
  'commandId',
  'miniAppName',
  'action',
] as const

/** The scalar identifiers instrumentation may see — never the payload itself. */
function rpcAttributes(
  payload: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const attributes: Record<string, string | number | boolean | null> = {}
  for (const key of RPC_ATTRIBUTE_KEYS) {
    const value = payload[key]
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      attributes[key] = typeof value === 'string' ? value.slice(0, 240) : value
    }
  }
  return attributes
}

export function request<T = unknown>(
  payload: Record<string, unknown>,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<T> {
  retain()
  const id = `q${++conn.nextRequestId}`
  const operation = typeof payload.t === 'string' ? payload.t : 'unknown'
  const startedAt = Date.now()
  const attributes = rpcAttributes(payload)
  return new Promise<T>((resolve, reject) => {
    if (options?.signal?.aborted) {
      release()
      reject(makeAbortError(ABORT_MESSAGE))
      return
    }
    const cancel = (error: unknown) => {
      if (!pendingRequests.has(id)) return
      conn.outbound = conn.outbound.filter((item) => item !== text)
      if (isOpen(conn.socket))
        conn.socket.send(JSON.stringify({ id: `cancel:${id}`, t: 'cancel', requestId: id }))
      const pending = settlePending(id)
      if (!pending) return
      pending.reject(error)
    }
    const timer = setTimeout(
      () => cancel(new ApiError('The server did not answer in time.', 0, 'ws_timeout')),
      options?.timeoutMs ?? REQUEST_TIMEOUT_MS,
    )
    const observe = (phase: 'succeeded' | 'failed' | 'cancelled', error?: unknown) =>
      emitRpcRequestEvent({
        phase,
        traceId: id,
        operation,
        ts: Date.now(),
        durationMs: Date.now() - startedAt,
        attributes,
        ...(phase === 'succeeded' ? {} : { error }),
      })
    const observedResolve = (value: unknown) => {
      observe('succeeded')
      resolve(value as T)
    }
    const observedReject = (error: unknown) => {
      observe(error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed', error)
      reject(error)
    }
    pendingRequests.set(id, { resolve: observedResolve, reject: observedReject, timer })
    emitRpcRequestEvent({ phase: 'started', traceId: id, operation, ts: startedAt, attributes })
    const text = JSON.stringify({ ...payload, id })
    if (isOpen(conn.socket)) conn.socket.send(text)
    else conn.outbound.push(text)
    options?.signal?.addEventListener('abort', () => cancel(makeAbortError(ABORT_MESSAGE)), {
      once: true,
    })
  })
}
