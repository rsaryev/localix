/**
 * Always-on production signal for prompt-cache regressions. The cacheable
 * system-prompt prefix must stay byte-identical across turns; a per-turn-volatile
 * token (timestamp with time, uuid, hash, jwt) leaking above the
 * `# Runtime context` boundary silently re-writes the provider cache EVERY turn —
 * an expensive regression with no error to notice. The full cache diagnostics
 * (`LOCALIX_CACHE_DIAGNOSTICS=1`) stableStringify the whole history and are too
 * costly to run by default; this guard runs only the tier-1 regex scan over the
 * prefix, and only when the prefix actually changed for the session. The message
 * guard retains only the prior trigger's serialized payload and verifies that the
 * same message is byte-identical when it reappears in the next request.
 */
import { detectCacheVolatility } from '@localixai/agent'

import { createBoundedCache } from '../../../lib/bounded-cache'

// Last-scanned prefix per session (bounded): rescan only when the prefix string
// changes, so steady-state turns pay one string compare, not a regex sweep. The
// bound evicts the least recently used session instead of clearing — a burst of
// new sessions must not reset every live session's scan state, and retaining one
// serialized trigger per session must not turn cache telemetry into a leak.
const MAX_TRACKED_SESSIONS = 512
const lastScannedPrefix = createBoundedCache<string, string>({ maxEntries: MAX_TRACKED_SESSIONS })
const lastScannedMessage = createBoundedCache<string, { id: string; payloadBytes: string }>({
  maxEntries: MAX_TRACKED_SESSIONS,
})

export function warnOnVolatileCachePrefix(sessionId: string, stablePrefix: string): void {
  if (lastScannedPrefix.get(sessionId) === stablePrefix) return
  lastScannedPrefix.set(sessionId, stablePrefix)

  const findings = detectCacheVolatility(stablePrefix, { max: 5 })
  if (findings.length === 0) return
  const detail = findings.map((f) => `${f.kind}@${f.index} "${f.sample}"`).join(', ')
  console.warn(
    `[cache] session ${sessionId}: volatile token(s) in the CACHED system-prompt prefix — ` +
      `the prompt cache re-writes every turn until this is fixed (move the content below the runtime-context boundary): ${detail}`,
  )
}

export function warnOnDivergingMessagePrefix(
  sessionId: string,
  messages: readonly { id: string; payload: unknown }[],
): void {
  const previous = lastScannedMessage.get(sessionId)
  const current = [...messages]
    .reverse()
    .find((message) => !message.id.startsWith('runtime-context-'))

  if (!current) {
    lastScannedMessage.delete(sessionId)
    return
  }
  lastScannedMessage.set(sessionId, {
    id: current.id,
    payloadBytes: JSON.stringify(current.payload),
  })

  if (!previous) return
  const replayed = messages.find((message) => message.id === previous.id)
  if (!replayed || JSON.stringify(replayed.payload) === previous.payloadBytes) return
  console.warn(
    `[cache] session ${sessionId}: CACHED message prefix diverged at message ${previous.id} — ` +
      'an already-sent message changed bytes between turns, so later assistant/tool content re-writes instead of reading from prompt cache',
  )
}
