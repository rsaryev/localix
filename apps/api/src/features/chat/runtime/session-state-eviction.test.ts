/**
 * The process-lifetime per-lane stores (context lane state, file mtimes) must evict as ONE
 * unit. Independently-capped FIFO maps desync: a lane surviving in `sessionFileMtimes` after
 * losing its `contextLanes` entry keeps write-guard state for a wire it no longer tracks.
 */
import { describe, expect, it } from 'bun:test'
import {
  evictSessionStateOverCap,
  type ContextLaneState,
  type RuntimeState,
} from './agent-runner-state'

type S = Pick<RuntimeState, 'contextLanes' | 'sessionFileMtimes'>

const lane = (): ContextLaneState => ({
  elidedToolCallIds: new Set(),
  elidedArgToolCallIds: new Set(),
})
const disposable = () => ({ dispose: () => {} }) as never

function stateWith(ids: string[]): S {
  const s: S = {
    contextLanes: new Map(),
    sessionFileMtimes: new Map(),
  }
  for (const id of ids) {
    s.contextLanes.set(id, lane())
    s.sessionFileMtimes.set(id, disposable())
  }
  return s
}

describe('evictSessionStateOverCap', () => {
  it('under the cap, nothing is evicted', () => {
    const s = stateWith(['a', 'b'])
    evictSessionStateOverCap(s, 2)
    expect(s.contextLanes.size).toBe(2)
  })

  it('over the cap, the oldest session leaves BOTH maps together', () => {
    const s = stateWith(['a', 'b', 'c'])
    evictSessionStateOverCap(s, 2)
    for (const m of [s.contextLanes, s.sessionFileMtimes]) {
      expect([...m.keys()]).toEqual(['b', 'c'])
    }
  })

  it('a session present in only ONE map (the desync it exists to prevent) still converges', () => {
    // Pin the KEY SETS, not a size bound: the union is evicted oldest-first, so 'a' and 'b'
    // leave BOTH maps and the desynced ghost is what remains. Independent capping would
    // instead leave contextLanes holding ['a','b'].
    const s = stateWith(['a', 'b'])
    s.sessionFileMtimes.set('ghost', disposable()) // desynced survivor
    s.sessionFileMtimes.set('c', disposable())
    evictSessionStateOverCap(s, 2)
    expect([...s.sessionFileMtimes.keys()]).toEqual(['ghost', 'c'])
    expect([...s.contextLanes.keys()]).toEqual([])
  })

  it('disposes what it evicts', () => {
    const s = stateWith(['a', 'b', 'c'])
    let disposed = 0
    s.sessionFileMtimes.set('a', { dispose: () => disposed++ } as never)
    evictSessionStateOverCap(s, 2)
    expect(disposed).toBe(1)
  })
})
