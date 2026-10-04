/**
 * The process-lifetime per-lane stores (context lane state, file mtimes, read dedup) must
 * evict as ONE unit. Independently-capped FIFO maps desync: a lane surviving in
 * `sessionReadDedup` after losing its `contextLanes` entry has its read stub consult empty
 * elision state.
 */
import { describe, expect, it } from 'bun:test'
import {
  evictSessionStateOverCap,
  type ContextLaneState,
  type RuntimeState,
} from './agent-runner-state'

type S = Pick<RuntimeState, 'contextLanes' | 'sessionFileMtimes' | 'sessionReadDedup'>

const lane = (): ContextLaneState => ({
  elidedToolCallIds: new Set(),
  elidedArgToolCallIds: new Set(),
  wireResultIds: new Set(),
})
const disposable = () => ({ dispose: () => {} }) as never

function stateWith(ids: string[]): S {
  const s: S = {
    contextLanes: new Map(),
    sessionFileMtimes: new Map(),
    sessionReadDedup: new Map(),
  }
  for (const id of ids) {
    s.contextLanes.set(id, lane())
    s.sessionFileMtimes.set(id, disposable())
    s.sessionReadDedup.set(id, disposable())
  }
  return s
}

describe('evictSessionStateOverCap', () => {
  it('under the cap, nothing is evicted', () => {
    const s = stateWith(['a', 'b'])
    evictSessionStateOverCap(s, 2)
    expect(s.contextLanes.size).toBe(2)
  })

  it('over the cap, the oldest session leaves ALL THREE maps together', () => {
    const s = stateWith(['a', 'b', 'c'])
    evictSessionStateOverCap(s, 2)
    for (const m of [s.contextLanes, s.sessionFileMtimes, s.sessionReadDedup]) {
      expect([...m.keys()]).toEqual(['b', 'c'])
    }
  })

  it('a session present in only ONE map (the desync it exists to prevent) still converges', () => {
    // The assertions here were `size <= 2` on two maps — a BOUND, not a result. Both the joint
    // eviction and the independent-per-map eviction this file exists to forbid satisfy it, so
    // the test could not discriminate the very bug named in its own title. Pin the KEY SETS: the
    // union is evicted oldest-first, so 'a' and 'b' leave ALL THREE maps and the desynced ghost
    // is what remains. Independent capping would instead leave contextLanes holding ['a','b'].
    const s = stateWith(['a', 'b'])
    s.sessionReadDedup.set('ghost', disposable()) // desynced survivor
    s.sessionReadDedup.set('c', disposable())
    evictSessionStateOverCap(s, 2)
    expect([...s.sessionReadDedup.keys()]).toEqual(['ghost', 'c'])
    expect([...s.contextLanes.keys()]).toEqual([])
    expect([...s.sessionFileMtimes.keys()]).toEqual([])
  })

  it('disposes what it evicts', () => {
    const s = stateWith(['a', 'b', 'c'])
    let disposed = 0
    s.sessionReadDedup.set('a', { dispose: () => disposed++ } as never)
    s.sessionFileMtimes.set('a', { dispose: () => disposed++ } as never)
    evictSessionStateOverCap(s, 2)
    expect(disposed).toBe(2)
  })
})
