/**
 * Streaming flush/publish path for a run: the cost-aware decision between a tiny
 * `message.delta` (trailing text/reasoning growth + per-item string appends) and
 * a full `message.updated` snapshot + DB persist, plus the live session-timing
 * broadcast.
 *
 * Split out of `event-handlers.ts` so the delta-vs-snapshot machinery lives apart
 * from the per-event accounting handlers. `TurnEventContext` is imported type-only,
 * so this introduces no runtime import cycle.
 */
import { diffItemsForAppends } from '@localixai/agent/agents'

import type { StoredMessagePayload } from '../../../../db'
import { STREAM_DB_FLUSH_MS } from '../agent-runner-constants'
import { addMessageTiming } from '../../session-timing'
import { finalizeTiming, type RunTurnState } from './turn-state'
import type { TurnEventContext } from './event-handlers'

/** Stable per-turn item ids the delta stream targets (one text + one reasoning). */
function turnItemIds(turnIndex: number): {
  textItemId: string
  reasoningItemId: string
} {
  return {
    textItemId: `text-${turnIndex}`,
    reasoningItemId: `reasoning-${turnIndex}`,
  }
}

/** Record what the UI now has, so the next tick can diff against it. */
function resetDeltaBaseline(state: RunTurnState, snapshot: StoredMessagePayload): void {
  const { textItemId, reasoningItemId } = turnItemIds(state.currentTurnIndex)
  state.lastSent.text = snapshot.content ?? ''
  state.lastSent.reasoning = snapshot.reasoning ?? ''
  state.lastSent.items = snapshot.items
  state.lastSent.textItemId = textItemId
  state.lastSent.reasoningItemId = reasoningItemId
}

/** DB-flush cadence bounds: small messages checkpoint often, huge ones back off. */
const MAX_DB_FLUSH_MS = 2000
/** ~how many payload bytes buy one millisecond of flush interval (512 → 1MB ≈ 2s). */
const DB_FLUSH_BYTES_PER_MS = 512

/**
 * Cheap O(items) size estimate of the payload — the strings that dominate a
 * streaming message (narrative, command output, streamed args), not exact JSON
 * bytes. Only drives the flush-cadence backoff, so precision is irrelevant.
 */
function approxPayloadBytes(snapshot: StoredMessagePayload): number {
  let bytes = (snapshot.content?.length ?? 0) + (snapshot.reasoning?.length ?? 0)
  for (const it of snapshot.items ?? []) {
    bytes += 256
    const raw = it as unknown as Record<string, unknown>
    for (const field of ['text', 'output', 'resultText'] as const) {
      const v = raw[field]
      if (typeof v === 'string') bytes += v.length
    }
    for (const rec of [raw.input, raw.output]) {
      if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
        for (const v of Object.values(rec)) {
          if (typeof v === 'string') bytes += v.length
        }
      }
    }
  }
  return bytes
}

/**
 * The persist cadence for THIS payload: the base STREAM_DB_FLUSH_MS for normal
 * replies, stretching linearly with payload size up to MAX_DB_FLUSH_MS. The
 * full persist does O(payload) synchronous work (serialize + SQLite write +
 * event stringify) on the ONE Bun thread every session shares — a fixed 120ms
 * cadence made that work quadratic-feeling on tool-heavy messages and froze
 * every other session's stream. Deltas carry the UI in between; a skipped
 * write is superseded by the per-turn message_end persist and the run-end
 * persist (`currentPayload` is the in-memory source of truth).
 */
function dbFlushIntervalMs(snapshot: StoredMessagePayload): number {
  return Math.min(
    MAX_DB_FLUSH_MS,
    Math.max(STREAM_DB_FLUSH_MS, approxPayloadBytes(snapshot) / DB_FLUSH_BYTES_PER_MS),
  )
}

/**
 * Stream one assistant-message tick to the UI as cheaply as correctness allows.
 *
 * - Every dbFlushIntervalMs (120ms for normal replies, backing off with payload
 *   size): a full `message.updated` snapshot + DB persist. This is also the
 *   delta RESYNC point — any drift self-heals here.
 * - Between flushes, when EVERY change since the last publish is provable
 *   string-suffix growth — trailing text/reasoning on the current turn's items,
 *   a command's streamed `output`, tool args being typed (`input.content` of a
 *   `write`), a generic tool's streamed `output.content` — a tiny
 *   `message.delta` carrying just the appended suffixes, instead of re-shipping
 *   the whole cumulative payload (which was ~130x egress amplification on long
 *   replies, and worse on tool-heavy ones). Anything structural (an item
 *   appearing, a status change, a non-string field moving) → full snapshot.
 *
 * Deltas are NON-REPLAYABLE — a reconnecting client rebuilds from the DB and
 * rides the next full snapshot.
 */
/**
 * Persist NOW, whatever the cadence says, and reset the delta baseline so the next
 * `flushOrPublish` diffs against what is actually on disk.
 *
 * For the one fact that must not depend on timing: that a side-effecting tool call was in
 * flight. Everything else rides `flushOrPublish`, deliberately.
 */
export async function persistNow(
  ctx: TurnEventContext,
  snapshot: StoredMessagePayload,
): Promise<void> {
  const { env, state } = ctx
  state.lastDbFlushAt = Date.now()
  resetDeltaBaseline(state, snapshot)
  await env.persistAndPublish(
    ctx.userId,
    ctx.session.id,
    ctx.assistantMessageId,
    snapshot,
    state.assistantCreatedAt,
  )
}

export async function flushOrPublish(
  ctx: TurnEventContext,
  snapshot: StoredMessagePayload,
): Promise<void> {
  const { env, state } = ctx
  const nowMs = Date.now()
  if (
    nowMs - state.lastDbFlushAt >= STREAM_DB_FLUSH_MS &&
    nowMs - state.lastDbFlushAt >= dbFlushIntervalMs(snapshot)
  ) {
    state.lastDbFlushAt = nowMs
    resetDeltaBaseline(state, snapshot)
    await env.persistAndPublish(
      ctx.userId,
      ctx.session.id,
      ctx.assistantMessageId,
      snapshot,
      state.assistantCreatedAt,
    )
    return
  }

  const text = snapshot.content ?? ''
  const reasoning = snapshot.reasoning ?? ''
  const { textItemId, reasoningItemId } = turnItemIds(state.currentTurnIndex)
  const base = state.lastSent

  const passthroughNarrativeIds = new Set([textItemId, reasoningItemId])
  const itemAppends =
    textItemId === base.textItemId && reasoningItemId === base.reasoningItemId
      ? diffItemsForAppends(base.items, snapshot.items, passthroughNarrativeIds)
      : null

  const canDelta =
    itemAppends !== null &&
    text.startsWith(base.text) &&
    reasoning.startsWith(base.reasoning) &&
    (text.length > base.text.length ||
      reasoning.length > base.reasoning.length ||
      itemAppends.length > 0)

  if (canDelta) {
    const textAppend = text.slice(base.text.length)
    const reasoningAppend = reasoning.slice(base.reasoning.length)
    env.deps.streamRegistry.publish(ctx.userId, ctx.session.id, {
      type: 'message.delta',
      sessionId: ctx.session.id,
      messageId: ctx.assistantMessageId,
      ...(textAppend ? { textItemId, textAppend } : {}),
      ...(reasoningAppend ? { reasoningItemId, reasoningAppend } : {}),
      ...(itemAppends.length > 0 ? { itemAppends } : {}),
    })
    base.text = text
    base.reasoning = reasoning
    base.items = snapshot.items
    return
  }

  // Structural change (or first tick of a turn) → full snapshot, no DB write.
  resetDeltaBaseline(state, snapshot)
  env.publishMessageSnapshot(
    ctx.userId,
    ctx.session.id,
    ctx.assistantMessageId,
    snapshot,
    state.assistantCreatedAt,
    env.now(),
  )
}

/** Finalize timing and broadcast the live session-timing aggregate. */
export function publishSessionTiming(ctx: TurnEventContext): void {
  finalizeTiming(ctx.state)
  ctx.env.deps.streamRegistry.publish(ctx.userId, ctx.session.id, {
    type: 'session_timing.updated',
    sessionId: ctx.session.id,
    timing: addMessageTiming(ctx.state.baseSessionTiming, ctx.state.timing),
  })
}
