/**
 * The two PER-AGENT-LANE stores that outlive a single run.
 *
 * A run rebuilds its tool registry from scratch every time; these do not. That is
 * the point of them:
 *
 *  - `fileMtimes` — read-before-write / stale-file bookkeeping for the file tools.
 *    A file read in turn 1 must still count as "seen" when turn 3 writes it.
 *  - `context`    — what the lane's wire holds (the elided id sets, the usage-anchor
 *    proof, a checkpoint the in-run policy asked for). The VIEW itself is durable.
 *
 * Both are scoped to (session, agent): a colleague's read cannot unlock this agent's
 * blind-overwrite guard, and a colleague's wire cannot touch its elision ratchet.
 * They are keyed IDENTICALLY, which lets `evictSessionStateOverCap` drop a lane from
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
import { agentLaneKey, type ExecutionAddress } from '../../../agent-core/execution-address'

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
  address: ExecutionAddress,
): SessionStores {
  const { contextLanes, sessionFileMtimes } = state
  const key = agentLaneKey(address)

  let fileMtimes = sessionFileMtimes.get(key)
  if (!fileMtimes) {
    fileMtimes = createFileMtimeStore()
    sessionFileMtimes.set(key, fileMtimes)
  }

  let context = contextLanes.get(key)
  if (!context) {
    context = {
      elidedToolCallIds: new Set(),
      elidedArgToolCallIds: new Set(),
    }
    contextLanes.set(key, context)
  }

  evictSessionStateOverCap(state)
  return { fileMtimes, context }
}
