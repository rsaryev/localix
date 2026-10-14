import type { MessageTiming, SessionTiming } from './contracts'
import type { StoredMessagePayload } from '../../db/payload'

/** Empty session aggregate. */
export function emptySessionTiming(): SessionTiming {
  return {
    totalMs: 0,
    modelMs: 0,
    revealMs: 0,
    toolGenMs: 0,
    waitMs: 0,
    toolMs: 0,
    hitlMs: 0,
    idleMs: 0,
    turns: 0,
    runs: 0,
  }
}

/** Fold one message's timing into a session aggregate (returns a new object). */
export function addMessageTiming(agg: SessionTiming, t: MessageTiming): SessionTiming {
  return {
    totalMs: agg.totalMs + t.totalMs,
    modelMs: agg.modelMs + t.modelMs,
    revealMs: agg.revealMs + (t.revealMs ?? 0),
    toolGenMs: agg.toolGenMs + (t.toolGenMs ?? 0),
    waitMs: agg.waitMs + (t.waitMs ?? 0),
    toolMs: agg.toolMs + t.toolMs,
    hitlMs: agg.hitlMs + t.hitlMs,
    idleMs: agg.idleMs + t.idleMs,
    turns: agg.turns + t.turns,
    runs: agg.runs + 1,
  }
}

/**
 * Derive the session timing aggregate by summing the timing of every assistant
 * message that carries one. Returns null when no message has timing yet.
 */
export function deriveSessionTiming(payloads: StoredMessagePayload[]): SessionTiming | null {
  let agg: SessionTiming | null = null
  for (const payload of payloads) {
    if (!payload.timing) continue
    agg = addMessageTiming(agg ?? emptySessionTiming(), payload.timing)
  }
  return agg
}
