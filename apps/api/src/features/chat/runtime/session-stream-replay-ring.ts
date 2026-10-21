import type { AgentStreamEvent } from '../contracts'
import type { StreamEnvelope } from './session-stream-registry'

// Drop a stale snapshot-shaped event from a replay ring before pushing the new
// one: their UI handling is pure last-wins, so a long streaming turn would
// otherwise park hundreds of near-identical multi-KB `message.updated` snapshots
// (and replay them all as a burst on reconnect). `session_timing.updated` is
// one-per-session. Returns the (possibly mutated) buffer for chaining.
const compactSnapshot = (buffer: StreamEnvelope[], event: AgentStreamEvent) => {
  if (event.type === 'message.updated') {
    const messageId = event.message.id
    const stale = buffer.findIndex(
      (e) =>
        e.event.type === 'message.updated' &&
        e.event.sessionId === event.sessionId &&
        e.event.message.id === messageId,
    )
    if (stale !== -1) buffer.splice(stale, 1)
  } else if (event.type === 'session_timing.updated') {
    // Match per-session: the global ring interleaves users/sessions, so a bare
    // type match would wrongly drop another session's timing snapshot.
    const stale = buffer.findIndex(
      (e) => e.event.type === 'session_timing.updated' && e.event.sessionId === event.sessionId,
    )
    if (stale !== -1) buffer.splice(stale, 1)
  }
  return buffer
}

// Append an envelope to a ring buffer keyed by session/user: compact stale
// snapshots first, push, trim to `maxSize`, re-insert at the tail (so the key
// counts as most-recently-used for eviction), then run the ring's eviction.
// Shared by the per-session and per-user (global firehose) rings.
export const pushToRing = (
  log: Map<string, StreamEnvelope[]>,
  key: string,
  event: AgentStreamEvent,
  envelope: StreamEnvelope,
  maxSize: number,
  evict: () => void,
) => {
  const buffered = compactSnapshot(log.get(key) ?? [], event)
  buffered.push(envelope)
  // The id of the newest frame trimmed off the front: a cursor older than it cannot be replayed.
  const trimmed =
    buffered.length > maxSize ? buffered.splice(0, buffered.length - maxSize).at(-1)!.id : null
  log.delete(key)
  log.set(key, buffered)
  evict()
  return trimmed
}
