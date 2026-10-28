import { describe, expect, test } from 'bun:test'
import {
  createRuntimeState,
  evictSessionStateOverCap,
  forgetSessionRuntimeState,
} from '../agent-runner-state'
import { testWork } from '../../../../testing/work-fixture'
import { ensureSessionStores } from './session-stores'

describe('session runtime stores', () => {
  test('another session cannot consume a prior read, its wire evidence or its checkpoint request', () => {
    const state = createRuntimeState(testWork())
    const own = ensureSessionStores(state, 'a')
    own.fileMtimes.record('shared-file', 1)
    const other = ensureSessionStores(state, 'b')
    expect(other.fileMtimes.has('shared-file')).toBe(false)
    other.fileMtimes.record('shared-file', 2)
    other.context.elidedToolCallIds.add('read-a')
    other.context.checkpointDue = 'ceiling'
    const resumed = ensureSessionStores(state, 'a')
    expect(resumed.context).toBe(own.context)
    expect(resumed.fileMtimes).toBe(own.fileMtimes)
    expect(resumed.fileMtimes.isStale('shared-file', 2)).toBe(true)
    expect(other.fileMtimes.isStale('shared-file', 2)).toBe(false)
    expect(resumed.context.elidedToolCallIds.has('read-a')).toBe(false)
    expect(resumed.context.checkpointDue).toBeUndefined()
    expect(ensureSessionStores(state, 'b').context.checkpointDue).toBe('ceiling')
  })

  test('deletion disposes the session’s stores, including one missing from the context map', () => {
    const state = createRuntimeState(testWork())
    const first = ensureSessionStores(state, 'conversation')
    const survivor = ensureSessionStores(state, 'conversation-extra')
    for (const stores of [first, survivor]) stores.fileMtimes.record('file', 1)
    state.contextLanes.delete('conversation')
    forgetSessionRuntimeState(state, 'conversation')
    expect(first.fileMtimes.has('file')).toBe(false)
    expect(survivor.fileMtimes.has('file')).toBe(true)
    for (const map of [state.contextLanes, state.sessionFileMtimes]) {
      expect([...map.keys()]).toEqual(['conversation-extra'])
    }
  })

  test('eviction removes both stores for one session, preserving the other', () => {
    const state = createRuntimeState(testWork())
    const first = ensureSessionStores(state, 'a')
    const second = ensureSessionStores(state, 'b')
    first.fileMtimes.record('file', 1)
    evictSessionStateOverCap(state, 1)
    expect(first.fileMtimes.has('file')).toBe(false)
    expect(state.contextLanes.get('b')).toBe(second.context)
    expect(ensureSessionStores(state, 'a').context).not.toBe(first.context)
  })
})
