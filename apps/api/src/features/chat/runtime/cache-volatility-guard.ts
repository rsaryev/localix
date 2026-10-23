/**
 * Always-on production signal for prompt-cache regressions. The cacheable
 * system-prompt prefix must stay byte-identical across turns; a per-turn-volatile
 * token (timestamp with time, uuid, hash, jwt) leaking above the
 * `# Runtime context` boundary silently re-writes the provider cache EVERY turn —
 * an expensive regression with no error to notice. The full cache diagnostics
 * (`LOCALIX_CACHE_DIAGNOSTICS=1`) stableStringify the whole history and are too
 * costly to run by default; this guard runs only the tier-1 regex scan over the
 * prefix, and only when the prefix actually changed for the session.
 */
import { detectCacheVolatility } from '@localixai/agent'

import { createBoundedCache } from '../../../lib/bounded-cache'

// Last-scanned prefix per session (bounded): rescan only when the prefix string
// changes, so steady-state turns pay one string compare, not a regex sweep. The
// bound evicts the least recently used session instead of clearing — a burst of
// new sessions must not reset every live session's scan state.
const MAX_TRACKED_SESSIONS = 512
const lastScannedPrefix = createBoundedCache<string, string>({ maxEntries: MAX_TRACKED_SESSIONS })

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
