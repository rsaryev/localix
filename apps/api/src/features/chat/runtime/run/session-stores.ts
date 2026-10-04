/**
 * The three PER-AGENT-LANE stores that outlive a single run.
 *
 * A run rebuilds its tool registry from scratch every time; these do not. That is
 * the point of them:
 *
 *  - `fileMtimes` — read-before-write / stale-file bookkeeping for the file tools.
 *    A file read in turn 1 must still count as "seen" when turn 3 writes it.
 *  - `readDedup`  — `read`'s repeat-read dedup. Without cross-run lifetime, every
 *    new user message makes the model re-download files it already has in history.
 *  - `context`    — what the lane's wire holds (the elided/wire id sets, the usage-anchor
 *    proof, a checkpoint the in-run policy asked for). The VIEW itself is durable.
 *
 * All three are scoped to (session, agent): a colleague's read cannot unlock this
 * agent's blind-overwrite guard, and a colleague's wire cannot invalidate its dedup.
 * They are keyed IDENTICALLY, which lets `evictSessionStateOverCap`
 * drop a lane from all three as one unit. That pairing invariant used to be a
 * comment asserted at three scattered sites; here it is the module's whole job:
 * one call creates whatever is missing, then evicts once.
 */
import {
  createFileMtimeStore,
  type FileMtimeStore,
} from '../../../agent-core/tools/file/file-utils'
import {
  createReadDedupStore,
  type ReadDedupStore,
} from '../../../agent-core/tools/file/read-dedup'
import {
  evictSessionStateOverCap,
  type ContextLaneState,
  type RuntimeState,
} from '../agent-runner-state'
import { agentLaneKey, type ExecutionAddress } from '../../../agent-core/execution-address'

export interface SessionStores {
  fileMtimes: FileMtimeStore
  readDedup: ReadDedupStore
  context: ContextLaneState
}

/**
 * Reuse (or create) this lane's three paired stores, then bound the outer maps.
 * New lanes are inserted last, so eviction cannot reap what this call just created.
 */
export function ensureSessionStores(
  state: Pick<RuntimeState, 'contextLanes' | 'sessionFileMtimes' | 'sessionReadDedup'>,
  address: ExecutionAddress,
): SessionStores {
  const { contextLanes, sessionFileMtimes, sessionReadDedup } = state
  const key = agentLaneKey(address)

  let fileMtimes = sessionFileMtimes.get(key)
  if (!fileMtimes) {
    fileMtimes = createFileMtimeStore()
    sessionFileMtimes.set(key, fileMtimes)
  }

  let readDedup = sessionReadDedup.get(key)
  if (!readDedup) {
    readDedup = createReadDedupStore()
    sessionReadDedup.set(key, readDedup)
  }

  let context = contextLanes.get(key)
  if (!context) {
    context = {
      elidedToolCallIds: new Set(),
      elidedArgToolCallIds: new Set(),
      wireResultIds: new Set(),
    }
    contextLanes.set(key, context)
  }

  evictSessionStateOverCap(state)
  return { fileMtimes, readDedup, context }
}
