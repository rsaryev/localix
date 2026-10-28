/**
 * The two PER-SESSION stores that outlive a single run.
 *
 * A run rebuilds its tool registry from scratch every time; these do not. That is
 * the point of them:
 *
 *  - `fileMtimes` — read-before-write / stale-file bookkeeping for the file tools.
 *    A file read in turn 1 must still count as "seen" when turn 3 writes it.
 *  - `context`    — what the lane's wire holds (the elided id sets, the usage-anchor
 *    proof, a checkpoint the in-run policy asked for). The VIEW itself is durable.
 *
 * Both are scoped to the session: another session's read cannot unlock this one's
 * blind-overwrite guard, and another session's wire cannot touch its elision ratchet.
 * They are keyed IDENTICALLY, which lets `evictSessionStateOverCap` drop a session from
 * both as one unit. One call creates whatever is missing, then evicts once.
 */
import {
  createFileMtimeStore,
  type FileMtimeStore,
} from '../../../agent-core/tools/file/file-utils'
import {
  evictSessionStateOverCap,
  type ContextLaneState,
  type RuntimeState,
} from '../agent-runner-state'

export interface SessionStores {
  fileMtimes: FileMtimeStore
  context: ContextLaneState
}

/**
 * Reuse (or create) this lane's paired stores, then bound the outer maps.
 * New lanes are inserted last, so eviction cannot reap what this call just created.
 */
export function ensureSessionStores(
  state: Pick<RuntimeState, 'contextLanes' | 'sessionFileMtimes'>,
  sessionId: string,
): SessionStores {
  const { contextLanes, sessionFileMtimes } = state
  let fileMtimes = sessionFileMtimes.get(sessionId)
  if (!fileMtimes) {
    fileMtimes = createFileMtimeStore()
    sessionFileMtimes.set(sessionId, fileMtimes)
  }

  let context = contextLanes.get(sessionId)
  if (!context) {
    context = {
      elidedToolCallIds: new Set(),
      elidedArgToolCallIds: new Set(),
    }
    contextLanes.set(sessionId, context)
  }

  evictSessionStateOverCap(state)
  return { fileMtimes, context }
}

/**
 * `/compact`: the session's NEXT turn takes a context checkpoint, whatever was
 * measured, and tells Claude Code's PreCompact hooks it was asked for with `instructions`. The
 * request lives on the lane until that turn's view stage consumes it (`stages/view.ts`).
 */
export function requestCheckpoint(
  state: Pick<RuntimeState, 'contextLanes' | 'sessionFileMtimes'>,
  sessionId: string,
  instructions: string,
): void {
  ensureSessionStores(state, sessionId).context.manualCompact = { instructions }
}
