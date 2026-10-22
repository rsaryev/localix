/**
 * THE LANES a parent's delegated children run in — at most `DELEGATION_SLOT_CAP` at once, the rest
 * waiting their turn: higher priority first, and first come first served within a priority.
 *
 * WHY A QUEUE AND NOT A REFUSAL. The cap exists because concurrency is what broke: one session
 * started 154 provider runs inside one minute and 741 of its 782 children died of the saturation
 * that caused (`delegation-budget.ts`). The cap used to be enforced by REFUSING the delegation —
 * "3 are running, delegate later" — which handed the scheduling back to the model: it had to
 * remember the work, notice a slot had freed, and ask again, and it usually did the work itself
 * instead. Waiting is what a lane means; the host can do it without forgetting.
 *
 * One pool per PARENT session. Everything that starts a child's run on an agent's behalf goes
 * through it — a new delegation and a message that wakes a finished child alike — so the cap
 * counts runs, not the way they began. A person writing into a child's chat does not: the cap
 * guards against an agent's burst, not against the person.
 *
 * SYNCHRONOUS DECISIONS. `requestLane` admits or queues in the same microtask it is called in, so
 * several delegation calls of one model step observe each other — the burst that motivated the cap
 * is exactly the case an awaited count gets wrong. In-process state, like the runner's own
 * `activeRuns`: a restart stops every child anyway (`markRunningSessionsStopped`), so nothing is
 * lost that a durable record would have kept.
 */
import { DELEGATION_SLOT_CAP } from './delegation-budget'

/**
 * How urgent a child's task is. A fork always queues as `normal`; older delegated children kept the
 * priority their delegation stored, which their later runs still inherit. Three levels, because a
 * model picked among three consistently; a finer scale is chosen at random and orders nothing.
 */
export const DELEGATION_PRIORITIES = ['high', 'normal', 'low'] as const
export type DelegationPriority = (typeof DELEGATION_PRIORITIES)[number]

/** Lower runs first. */
const RANK: Record<DelegationPriority, number> = { high: 0, normal: 1, low: 2 }

interface Waiting {
  childId: string
  priority: DelegationPriority
  start: () => void
}

interface Pool {
  /** The parent session whose children the pool holds. */
  owner: string
  /** How many of them run at once. */
  cap: number
  running: Set<string>
  waiting: Waiting[]
}

/**
 * Which pool a child asks in. A parent's delegated children share one pool, keyed by the parent,
 * at `DELEGATION_SLOT_CAP`. A workflow run's agents are the same parent's children in a pool of
 * their own (`key`), at the workflow's limit: Claude Code runs up to 16 of them at once, and
 * sharing the chat's three lanes would both slow the run and leave the chat's own `delegate`
 * calls queued behind a fan-out of hundreds.
 */
export interface LaneSpec {
  key?: string
  cap?: number
}

/** Pools by key (the parent's id, or a workflow run's key). */
const pools = new Map<string, Pool>()
/** childId → the key of the pool it holds or waits in. */
const parentOf = new Map<string, string>()

export type LaneAdmission =
  /** Holds a lane: `start` ran, or already had for this child. */
  | { state: 'running' }
  /** Waits; `start` runs when a lane frees. `position` is 1-based. */
  | { state: 'queued'; position: number }

function poolOf(parentId: string, lane: LaneSpec): Pool {
  const key = lane.key ?? parentId
  let pool = pools.get(key)
  if (!pool) {
    pool = {
      owner: parentId,
      cap: lane.cap ?? DELEGATION_SLOT_CAP,
      running: new Set(),
      waiting: [],
    }
    pools.set(key, pool)
  }
  return pool
}

/** Run a start without letting it throw into the admission that granted its lane. */
function begin(childId: string, start: () => void): void {
  try {
    start()
  } catch (error) {
    console.warn(`[delegate] child ${childId} failed to start in its lane:`, error)
    releaseLane(childId)
  }
}

/**
 * Place `entry` among the waiting: behind every child of its own priority or higher, ahead of
 * every lower one — so a priority orders the queue and, within one priority, first come is first
 * served. A waiting `high` never pre-empts a RUNNING child: it takes the next lane that frees,
 * because stopping someone's work midway to start another's wastes both.
 */
function enqueue(pool: Pool, entry: Waiting): number {
  const at = pool.waiting.findIndex((other) => RANK[other.priority] > RANK[entry.priority])
  const index = at < 0 ? pool.waiting.length : at
  pool.waiting.splice(index, 0, entry)
  return index + 1
}

/**
 * Ask for a lane for `childId` at `priority`. Admitted now when one is free (and `start` runs
 * before this returns), otherwise queued by priority. A child that already holds a lane is not
 * queued twice; one that is already WAITING is re-placed if its priority changed — a message
 * that raises a task's urgency moves it up — and `start` is not called again: the caller adds to
 * the work that child will do rather than scheduling more.
 */
export function requestLane(
  parentId: string,
  childId: string,
  start: () => void,
  priority: DelegationPriority = 'normal',
  lane: LaneSpec = {},
): LaneAdmission {
  const key = lane.key ?? parentId
  const pool = poolOf(parentId, lane)
  if (pool.running.has(childId)) return { state: 'running' }
  const waitingAt = pool.waiting.findIndex((entry) => entry.childId === childId)
  if (waitingAt >= 0) {
    const [entry] = pool.waiting.splice(waitingAt, 1)
    return { state: 'queued', position: enqueue(pool, { ...entry!, priority }) }
  }
  parentOf.set(childId, key)
  if (pool.running.size < pool.cap) {
    pool.running.add(childId)
    begin(childId, start)
    return { state: 'running' }
  }
  return { state: 'queued', position: enqueue(pool, { childId, priority, start }) }
}

/** Start waiting children, oldest first, while lanes are free. */
function pump(key: string): void {
  const pool = pools.get(key)
  if (!pool) return
  while (pool.running.size < pool.cap && pool.waiting.length > 0) {
    const next = pool.waiting.shift()!
    pool.running.add(next.childId)
    begin(next.childId, next.start)
  }
  if (pool.running.size === 0 && pool.waiting.length === 0) pools.delete(key)
}

/**
 * The child's run is over: give its lane to the next in line. Idempotent — a child releases from
 * wherever its end is seen (the run's end, a launch that threw), and only the first counts.
 */
export function releaseLane(childId: string): void {
  const key = parentOf.get(childId)
  if (!key) return
  const pool = pools.get(key)
  if (!pool?.running.delete(childId)) return
  parentOf.delete(childId)
  pump(key)
}

/** Withdraw a child that is still WAITING (it was closed). A running child is stopped instead. */
export function cancelLane(childId: string): boolean {
  const key = parentOf.get(childId)
  const pool = key ? pools.get(key) : undefined
  const at = pool?.waiting.findIndex((entry) => entry.childId === childId) ?? -1
  if (!pool || at < 0) return false
  pool.waiting.splice(at, 1)
  parentOf.delete(childId)
  if (pool.running.size === 0 && pool.waiting.length === 0) pools.delete(key!)
  return true
}

/** Where a child stands: holding a lane, waiting (with its 1-based place), or neither. */
export function laneOf(
  childId: string,
): { state: 'running' } | { state: 'queued'; position: number } | undefined {
  const key = parentOf.get(childId)
  const pool = key ? pools.get(key) : undefined
  if (!pool) return undefined
  if (pool.running.has(childId)) return { state: 'running' }
  const at = pool.waiting.findIndex((entry) => entry.childId === childId)
  return at >= 0 ? { state: 'queued', position: at + 1 } : undefined
}

/**
 * Has `parentId` children of its own still running or waiting, in any of its pools? A pool exists
 * only while it holds one (it is dropped when the last leaves), so this is whether the parent's
 * subtree is still at work — what a child's report waits on before it calls itself done (`run/child-run-report.ts`).
 */
export function hasChildrenAtWork(parentId: string): boolean {
  for (const pool of pools.values()) if (pool.owner === parentId) return true
  return false
}

/** Test seam: forget every lane. Never call this from production code. */
export function __resetDelegationLanes(): void {
  pools.clear()
  parentOf.clear()
}
