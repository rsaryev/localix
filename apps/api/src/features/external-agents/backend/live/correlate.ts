/**
 * Correlate a LIVE delegation to the native session id its transcript is being written under.
 *
 * This is the hinge of the whole plugin: the id that names a running delegation must be the id
 * that names its transcript on disk, or "link a live agent" and "browse past sessions" are two
 * unrelated features wearing one name. An integration that reported each agent's native session
 * reference would give the same identity. We have no integration channel, so we recover the same
 * fact by observation.
 *
 * THE RULE, and its honesty caveat. After a delegation opens at time T, its provider begins
 * writing a transcript. We look for the session that STARTED in that window — `startedAt >= T -
 * SLACK_MS` — and adopt it only if there is exactly one. If several qualify we adopt NONE: an
 * ambiguous correlation is worse than no correlation, because attaching a live delegation to the
 * wrong transcript is silent and unrecoverable. The link then stays on its pending key, which is
 * fully usable for state and control; only the transcript is unavailable.
 *
 * WHY `startedAt` AND NOT `updatedAt`. It was `updatedAt`, which is the wrong question: a session
 * that has been running for hours is touched every few seconds, so every long-lived agent in the
 * directory is a candidate forever. With two Claude Code agents working in one project, started
 * hours apart, correlation was ambiguous at every window size and would have refused for as long as
 * they both ran. Concurrent agents in one project is not an edge case here; it is what this plugin
 * is FOR.
 *
 * A session that began hours before the terminal opened cannot be that terminal's agent, and
 * `startedAt` says so directly. Coverage is near-total (almost every Claude Code session, and every
 * Codex, opencode and Gemini one), and where a provider records no start the old last-touched test
 * still applies rather than making the session uncorrelatable.
 *
 * A cwd match is required when both sides know their cwd. That constraint removes the remaining
 * ambiguity: two agents of the same kind STARTING within seconds of each other in the SAME
 * directory is rare, while in different directories it is common.
 */

import type { SessionIndex } from '../discovery/index-cache'
import type { ProviderAdapter } from '../adapters/types'
import type { LiveStore } from './store'

/**
 * How far before the observed launch a transcript may have been touched and still be considered
 * this delegation's. Generous enough for a slow cold start, tight enough that yesterday's session
 * in the same directory never qualifies.
 */
const SLACK_MS = 90_000

/**
 * Correlation is retried because the transcript usually does not exist at the instant the terminal
 * opens — the agent writes its first record once it has booted.
 */
export const CORRELATE_ATTEMPT_DELAYS_MS = [1_500, 5_000, 15_000, 45_000] as const

export interface CorrelateResult {
  readonly adopted?: string
  readonly reason: string
}

export async function correlateOnce(
  index: SessionIndex,
  adapter: ProviderAdapter,
  live: LiveStore,
  terminalId: string,
  cwd?: string,
): Promise<CorrelateResult> {
  const entry = live.get(terminalId)
  if (!entry) return { reason: 'the delegation is no longer tracked' }
  if (entry.nativeSessionId) return { adopted: entry.nativeSessionId, reason: 'already correlated' }

  const { summaries } = await index.scan(adapter)
  const floor = entry.launchedAt - SLACK_MS
  // Started in the window — see the header. `updatedAt` is the fallback only for a session whose
  // provider recorded no start, which would otherwise be uncorrelatable forever.
  // A session another delegation already holds is not a candidate: two agents launched in one
  // directory would otherwise both adopt the first one's transcript before the second wrote its own.
  const held = new Set(
    live
      .list()
      .filter((other) => other.terminalId !== terminalId && other.provider === entry.provider)
      .flatMap((other) => (other.nativeSessionId ? [other.nativeSessionId] : [])),
  )
  let candidates = summaries.filter(
    (s) =>
      !held.has(s.nativeSessionId) &&
      (s.startedAt === undefined ? s.updatedAt >= floor : s.startedAt >= floor),
  )
  if (cwd) {
    const scoped = candidates.filter((s) => s.cwd === cwd)
    // Only narrow by cwd if it actually leaves something: a provider that does not record a cwd
    // (Gemini CLI) would otherwise correlate to nothing forever.
    if (scoped.length > 0) candidates = scoped
  }

  if (candidates.length === 0) {
    return {
      reason: `no ${adapter.displayName} session has STARTED since the agent launched`,
    }
  }
  if (candidates.length > 1) {
    // Ambiguity is resolved by refusing, not by picking the newest. See the header comment.
    return {
      reason: `${candidates.length} ${adapter.displayName} sessions started since launch, so the correlation is ambiguous and was not made`,
    }
  }

  const only = candidates[0]
  live.adopt(terminalId, only.nativeSessionId)
  return { adopted: only.nativeSessionId, reason: `correlated to ${only.sourcePath}` }
}
