/**
 * Observer channels of the socket: connection lifecycle, RPC instrumentation, diagnostics.
 *
 * None of them retains the transport — each is paired with a real subscription by its caller —
 * and every fan-out below isolates its handlers: one feature's throwing hook must not block the
 * hooks after it, strand queued RPCs behind an open socket, or stop the reconnect that follows.
 */

export type RpcRequestPhase = 'started' | 'succeeded' | 'failed' | 'cancelled'
export interface RpcRequestEvent {
  phase: RpcRequestPhase
  traceId: string
  operation: string
  ts: number
  durationMs?: number
  attributes: Readonly<Record<string, string | number | boolean | null>>
  error?: unknown
}
export type RpcRequestEventHandler = (event: RpcRequestEvent) => void

export type RealtimeDiagnosticSeverity = 'warning' | 'error'
export interface RealtimeDiagnosticEvent {
  id: string
  ts: number
  kind: string
  severity: RealtimeDiagnosticSeverity
  summary: string
  message?: string
  sessionId?: string
  attributes?: Readonly<Record<string, string | number | boolean | null>>
  error?: unknown
}
export type RealtimeDiagnosticEventHandler = (event: RealtimeDiagnosticEvent) => void

export type ConnectionHandler = () => void

export const reconnectHandlers = new Set<ConnectionHandler>()
export const connectedHandlers = new Set<ConnectionHandler>()
export const disconnectHandlers = new Set<ConnectionHandler>()
export const rpcRequestEventHandlers = new Set<RpcRequestEventHandler>()
export const realtimeDiagnosticHandlers = new Set<RealtimeDiagnosticEventHandler>()
let realtimeDiagnosticSequence = 0

export function emitRpcRequestEvent(event: RpcRequestEvent): void {
  for (const handler of rpcRequestEventHandlers) {
    try {
      handler(event)
    } catch (error) {
      console.error('[eventSocket] RPC observer threw', error)
    }
  }
}

export function emitRealtimeDiagnostic(
  event: Omit<RealtimeDiagnosticEvent, 'id' | 'ts'> & { ts?: number },
): void {
  realtimeDiagnosticSequence += 1
  const emitted: RealtimeDiagnosticEvent = {
    ...event,
    id: `realtime-${realtimeDiagnosticSequence.toString(36)}`,
    ts: event.ts ?? Date.now(),
  }
  for (const handler of realtimeDiagnosticHandlers) {
    try {
      handler(emitted)
    } catch (error) {
      // The diagnostics channel observes transport failures; it must never
      // recursively turn its own observer failure into another diagnostic.
      console.error('[eventSocket] diagnostic observer threw', error)
    }
  }
}

/** A lifecycle fan-out whose failing handler is reported, never propagated. */
function notifyEach(
  handlers: ReadonlySet<ConnectionHandler>,
  label: string,
  diagnostic: Pick<RealtimeDiagnosticEvent, 'kind' | 'summary' | 'message'>,
): void {
  for (const handler of handlers) {
    try {
      handler()
    } catch (error) {
      console.error(label, error)
      emitRealtimeDiagnostic({ ...diagnostic, severity: 'error', error })
    }
  }
}

export function notifyReconnectHandlers(): void {
  notifyEach(reconnectHandlers, 'Realtime reconnect handler failed', {
    kind: 'handler.reconcile',
    summary: 'Realtime reconciliation handler failed',
    message: 'One feature could not refresh after reconnecting.',
  })
}

export function notifyConnectedHandlers(): void {
  notifyEach(connectedHandlers, 'Realtime connect handler failed', {
    kind: 'handler.connected',
    summary: 'Realtime startup handler failed',
    message: 'One feature could not synchronize after connecting.',
  })
}

export function notifyDisconnectHandlers(): void {
  notifyEach(disconnectHandlers, 'Realtime disconnect handler failed', {
    kind: 'handler.disconnected',
    summary: 'Realtime fallback handler failed',
    message: 'One feature could not enter its disconnected state.',
  })
}

export function clearObservers(): void {
  reconnectHandlers.clear()
  connectedHandlers.clear()
  disconnectHandlers.clear()
  rpcRequestEventHandlers.clear()
  realtimeDiagnosticHandlers.clear()
  realtimeDiagnosticSequence = 0
}
