import type { ForkSeed } from '../../../agent-core/fork-seed'
import type { PersistedMessage } from '../../contracts'
import type { ChatRepository, SessionRecord } from '../../repository'
import { delegationPlace } from '../../session-provenance'

/** What a run of a fork is: the parent's call it came from, and what that run handed it. */
export interface ForkRun {
  seed: ForkSeed
  /** The parent's call that made the fork. */
  toolCallId: string
  /** The child's own copy of the parent's row at the call. */
  snapshotMessageId: string
  /** No run of the fork has answered yet: its request is the parent's plus the directive. */
  first: boolean
}

/**
 * The fork a run belongs to, or nothing when the session is no fork.
 *
 * A fork whose seed is missing is an error, not an ordinary child: it would run with another
 * system prompt, other tools and a closed profile, and present itself as the agent it is a copy of.
 */
export async function loadForkRun(
  repo: Pick<ChatRepository, 'getForkSeed'>,
  userId: string,
  session: Pick<SessionRecord, 'id' | 'provenance'>,
  history: readonly PersistedMessage[],
  runMessageId: string,
): Promise<ForkRun | undefined> {
  const { provenance } = session
  if (provenance.kind !== 'task-delegation' || !provenance.fork) return undefined
  const seed = await repo.getForkSeed(userId, session.id)
  if (!seed) throw new Error(`The fork ${session.id} has lost its seed, so it cannot run`)
  const { snapshotMessageId } = provenance.fork
  // Rows of the parent are inherited; an answer of the fork's own is an assistant row it wrote.
  const answered = history.some(
    (row) =>
      row.sessionId === session.id &&
      row.payload.role === 'assistant' &&
      row.id !== snapshotMessageId &&
      row.id !== runMessageId,
  )
  return { seed, toolCallId: provenance.toolCallId, snapshotMessageId, first: !answered }
}

/** How a run keys and times the provider's prompt cache (`AgentRuntimeRunInput`). */
export interface RunCacheKey {
  sessionId: string
  idleMs: number | undefined
  retention: 'short' | 'long' | undefined
}

/**
 * The cache identity of a run. An ordinary run is keyed by its own session. A fork is keyed by its
 * parent's (providers that look the cache up by key, not only by prefix, find the parent's entry),
 * keeps the parent's retention, and its first request follows the parent's by moments, so no idle
 * gap is reported against it.
 */
export function runCacheKey(
  fork: ForkRun | undefined,
  own: { sessionId: string; idleMs: number | undefined; retention: 'short' | 'long' | undefined },
): RunCacheKey {
  if (!fork) return own
  return {
    sessionId: fork.seed.cacheSessionId,
    idleMs: fork.first ? 0 : own.idleMs,
    retention: fork.seed.promptCacheRetention ?? own.retention,
  }
}

/**
 * The delegation depth a run budgets its context against. A delegated child budgets against a
 * smaller window than its parent (`contextWindowCapAt`), but a fork IS its parent: the view it
 * reads was planned under the parent's window, and judging the parent's measured size against a
 * smaller mark would re-plan that view and rewrite the prefix the fork exists to reuse.
 */
export function budgetDepth(session: Pick<SessionRecord, 'provenance'>, fork: ForkRun | undefined) {
  const depth = delegationPlace(session.provenance).depth
  return fork ? Math.max(0, depth - 1) : depth
}
