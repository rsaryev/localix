import { isSessionCursorNewer, parseSessionCursor } from '@localixai/api/ws-frame'

import type { AgentStreamEvent } from '../contracts'
import { emitRealtimeDiagnostic, notifyReconnectHandlers, notifyResyncHandlers } from './observers'
import { conn } from './state'
import { sessionHandlers } from './subscription'

// ---------------------------------------------------------------------------
// Session-frame coalescing.
//
// Each WebSocket message is its OWN macrotask, so applying frames straight from
// `onmessage` gives React one render pass PER FRAME — and with one session
// streaming plus several sub-agents (or a reconnect replaying its whole event
// backlog), that is hundreds of store commits + render passes per second: the
// "whole app freezes, then recovers" stall. Buffering session frames and
// draining them in ONE synchronous loop per tick means every zustand
// notification in the batch lands in the same task, so React 18 auto-batching
// collapses the burst into a single render pass.
//
// Only `s` (session) frames coalesce — they are the firehose. Plugin
// frames are low-rate and RPC responses resolve pending promises, so those
// dispatch inline (`dispatch.ts`). JSON.parse is deferred to the drain so a
// burst's parse cost also stays inside the one task.
// ---------------------------------------------------------------------------
// 20Hz is below a 60Hz display refresh but still reads as continuous streaming.
// The markdown surface smooths text between transport commits, so spending three
// store/reconciliation passes per visible frame only competes with input handling.
export const SESSION_FLUSH_MS = 50
/** Keep a replay/worker burst below one long task, then yield to input and paint. */
export const SESSION_FRAMES_PER_SLICE = 100

let pendingSessionFrames: { cursor: string; sessionId: string; json: string }[] = []
let sessionFlushTimer: ReturnType<typeof setTimeout> | null = null

type ParsedSessionFrame = {
  cursor: string
  sessionId: string
  event: AgentStreamEvent
}

export function enqueueSessionFrame(frame: { cursor: string; sessionId: string; json: string }) {
  pendingSessionFrames.push(frame)
  // A plain timeout, not rAF: background tabs suspend rAF entirely, while a
  // page with a live WebSocket is exempt from intensive timer throttling —
  // worst case a hidden tab drains ~1/s, which is exactly what it needs.
  sessionFlushTimer ??= setTimeout(drainSessionFrames, SESSION_FLUSH_MS)
}

/**
 * A buffered frame belongs to the subscribers that retained the transport when it arrived, so
 * a teardown drops the buffer rather than draining it: draining after the final subscriber left
 * would advance `lastCursor` past state no reducer applied.
 */
export function dropSessionFrames(): void {
  if (sessionFlushTimer) {
    clearTimeout(sessionFlushTimer)
    sessionFlushTimer = null
  }
  pendingSessionFrames = []
}

/**
 * Resynchronize by reconnecting: a cursor is an acknowledgement, not receipt telemetry, so the
 * reconnect resumes from the last frame a reducer applied and REST reconciliation converges.
 */
export function restartForResync(): void {
  pendingSessionFrames = []
  conn.socket?.close()
}

function appendOptional(previous?: string, next?: string): string | undefined {
  if (previous === undefined) return next
  if (next === undefined) return previous
  return previous + next
}

/** Merge adjacent append-only deltas targeting the same message items. */
function mergeAdjacentSessionDelta(
  previous: ParsedSessionFrame,
  next: ParsedSessionFrame,
): ParsedSessionFrame | null {
  if (
    previous.sessionId !== next.sessionId ||
    previous.event.type !== 'message.delta' ||
    next.event.type !== 'message.delta' ||
    previous.event.messageId !== next.event.messageId ||
    previous.event.textItemId !== next.event.textItemId ||
    previous.event.reasoningItemId !== next.event.reasoningItemId
  ) {
    return null
  }
  // Parsed frames are private to this pending accumulator until delivery. Grow
  // its append list in place so a burst does not recopy every prior append each
  // time another adjacent delta is folded into it.
  let itemAppends = previous.event.itemAppends
  if (next.event.itemAppends) {
    if (itemAppends) itemAppends.push(...next.event.itemAppends)
    else itemAppends = next.event.itemAppends
  }
  return {
    cursor: next.cursor,
    sessionId: next.sessionId,
    event: {
      ...previous.event,
      textAppend: appendOptional(previous.event.textAppend, next.event.textAppend),
      reasoningAppend: appendOptional(previous.event.reasoningAppend, next.event.reasoningAppend),
      contentAppend: appendOptional(previous.event.contentAppend, next.event.contentAppend),
      itemAppends,
    },
  }
}

function deliverSessionFrame(frame: ParsedSessionFrame): boolean {
  let applied = true
  for (const handler of sessionHandlers) {
    try {
      handler(frame.sessionId, frame.event)
    } catch (err) {
      console.error('[eventSocket] session handler threw', err)
      emitRealtimeDiagnostic({
        kind: 'handler.session',
        severity: 'error',
        summary: 'Session update handler failed',
        message: 'The update was not applied; realtime state will resynchronize.',
        sessionId: frame.sessionId,
        attributes: { eventType: frame.event.type },
        error: err,
      })
      applied = false
    }
  }
  if (applied) conn.lastCursor = frame.cursor
  return applied
}

/** A `transport.lagged` marker, validated; anything else under that type is a bad frame. */
function lagMarker(parsed: { type: string; skipped?: unknown; eventType?: unknown }) {
  if (
    !Number.isSafeInteger(parsed.skipped) ||
    (parsed.skipped as number) < 1 ||
    typeof parsed.eventType !== 'string'
  ) {
    throw new Error('Invalid transport lag marker')
  }
  return { skipped: parsed.skipped as number, eventType: parsed.eventType }
}

function parseSessionEvent(json: string) {
  const parsed = JSON.parse(json) as unknown
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { type?: unknown }).type !== 'string'
  ) {
    throw new Error('Invalid session event')
  }
  const transportEvent = parsed as { type: string; skipped?: unknown; eventType?: unknown }
  return transportEvent.type === 'transport.lagged'
    ? { lag: lagMarker(transportEvent) }
    : { event: parsed as AgentStreamEvent }
}

/** The stream missed frames after all: nothing it replayed can be taken as complete. */
function withdrawReplay(): void {
  conn.verifyEpoch = null
  if (!conn.openResumed) return
  conn.openResumed = false
  notifyResyncHandlers()
}

/** A server restarted since the cursor replays its own boot from zero, not what was missed. */
function checkResumedEpoch(cursor: string): void {
  const epoch = parseSessionCursor(cursor)?.epoch
  const expected = conn.verifyEpoch
  conn.verifyEpoch = null
  if (epoch !== expected) withdrawReplay()
}

function drainSessionFrames(): void {
  sessionFlushTimer = null
  // Consume from the front without swapping the whole queue out. Frames received
  // while this slice runs stay behind the remainder, preserving wire order.
  const frames = pendingSessionFrames.splice(0, SESSION_FRAMES_PER_SLICE)
  let pending: ParsedSessionFrame | null = null
  let sawTransportLag = false
  for (const frame of frames) {
    if (conn.verifyEpoch !== null) checkResumedEpoch(frame.cursor)
    // Reconnect replay and a superseded transport can overlap at the boundary.
    // Filter before delta coalescing: merging a duplicate append first would make
    // the repeated text indistinguishable from a legitimate larger delta.
    if (!isSessionCursorNewer(frame.cursor, pending?.cursor ?? conn.lastCursor)) continue
    let decoded: ReturnType<typeof parseSessionEvent>
    try {
      decoded = parseSessionEvent(frame.json)
    } catch (err) {
      console.error('[eventSocket] invalid session frame; reconnecting for resync', err)
      emitRealtimeDiagnostic({
        kind: 'frame.session.invalid',
        severity: 'error',
        summary: 'Session update was rejected',
        message: 'The realtime connection was restarted to resynchronize state.',
        sessionId: frame.sessionId,
        error: err,
      })
      return restartForResync()
    }
    if ('lag' in decoded) {
      if (pending && !deliverSessionFrame(pending)) return restartForResync()
      pending = null
      // The marker acknowledges the omitted live-only cursors only after the
      // authoritative reconciliation path has been scheduled below.
      emitRealtimeDiagnostic({
        kind: 'stream.lagged',
        severity: 'warning',
        summary: 'Realtime stream lagged',
        message:
          'Some live updates were skipped; authoritative state reconciliation was requested.',
        sessionId: frame.sessionId,
        attributes: decoded.lag,
      })
      conn.lastCursor = frame.cursor
      sawTransportLag = true
      withdrawReplay()
      continue
    }
    const parsed = { cursor: frame.cursor, sessionId: frame.sessionId, event: decoded.event }
    if (pending) {
      const merged = mergeAdjacentSessionDelta(pending, parsed)
      if (merged) {
        pending = merged
        continue
      }
      if (!deliverSessionFrame(pending)) return restartForResync()
    }
    pending = parsed
  }
  if (pending && !deliverSessionFrame(pending)) return restartForResync()
  if (sawTransportLag) notifyReconnectHandlers()
  // A backlog from a reconnect or several subagents must not monopolize the
  // main thread. Schedule the next ordered slice immediately after yielding.
  if (pendingSessionFrames.length > 0) {
    sessionFlushTimer ??= setTimeout(drainSessionFrames, 0)
  }
}
