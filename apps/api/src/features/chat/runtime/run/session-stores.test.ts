import { describe, expect, test } from 'bun:test'
import { agentLaneKey } from '../../../agent-core/execution-address'
import {
  createRuntimeState,
  evictSessionStateOverCap,
  forgetSessionRuntimeState,
  isWireResultElided,
} from '../agent-runner-state'
import { testWork } from '../../../../testing/work-fixture'
import { ensureSessionStores } from './session-stores'

const a = { sessionId: 'conversation', agentId: 'a' }
const b = { sessionId: 'conversation', agentId: 'b' }

describe('AgentLane runtime stores', () => {
  test('a colleague cannot consume a prior read, its wire evidence or its checkpoint request', () => {
    const state = createRuntimeState(testWork())
    const own = ensureSessionStores(state, a)
    own.fileMtimes.record('shared-file', 1)
    own.readDedup.record('shared-file', undefined, 'original', 'read-a')
    own.context.wireResultIds.add('read-a')
    const colleague = ensureSessionStores(state, b)
    expect(colleague.fileMtimes.has('shared-file')).toBe(false)
    colleague.fileMtimes.record('shared-file', 2)
    expect(colleague.readDedup.isUnchanged('shared-file', undefined, 'original')).toBe(false)
    expect(colleague.readDedup.lastCallId('shared-file', undefined)).toBeUndefined()
    expect(isWireResultElided(colleague.context, 'read-a')).toBe(true)
    colleague.readDedup.record('shared-file', undefined, 'edited', 'read-b')
    colleague.context.elidedToolCallIds.add('read-a')
    // A checkpoint the colleague's request policy asked for is that colleague's view only.
    colleague.context.checkpointDue = 'ceiling'
    const resumed = ensureSessionStores(state, a)
    expect(resumed.readDedup).toBe(own.readDedup)
    expect(resumed.fileMtimes).toBe(own.fileMtimes)
    expect(resumed.fileMtimes).not.toBe(colleague.fileMtimes)
    expect(resumed.fileMtimes.isStale('shared-file', 2)).toBe(true)
    expect(colleague.fileMtimes.isStale('shared-file', 2)).toBe(false)
    expect(resumed.readDedup.isUnchanged('shared-file', undefined, 'original')).toBe(true)
    expect(isWireResultElided(resumed.context, 'read-a')).toBe(false)
    expect(resumed.context.checkpointDue).toBeUndefined()
    expect(ensureSessionStores(state, b).context.checkpointDue).toBe('ceiling')
  })

  test('the same agent in another conversation has independent state', () => {
    const state = createRuntimeState(testWork())
    const first = ensureSessionStores(state, a)
    const other = ensureSessionStores(state, { ...a, sessionId: 'other' })
    expect(first.context).not.toBe(other.context)
    expect(first.readDedup).not.toBe(other.readDedup)
  })

  test('deletion disposes every lane, including one missing from the context map', () => {
    const state = createRuntimeState(testWork())
    const first = ensureSessionStores(state, a)
    const second = ensureSessionStores(state, b)
    const survivorAddress = { ...a, sessionId: 'conversation-extra' }
    const survivor = ensureSessionStores(state, survivorAddress)
    for (const stores of [first, second, survivor]) {
      stores.readDedup.record('file', undefined, 'bytes', 'read')
    }
    state.contextLanes.delete(agentLaneKey(b))
    forgetSessionRuntimeState(state, a.sessionId)
    expect(first.readDedup.lastCallId('file', undefined)).toBeUndefined()
    expect(second.readDedup.lastCallId('file', undefined)).toBeUndefined()
    expect(survivor.readDedup.lastCallId('file', undefined)).toBe('read')
    for (const map of [state.contextLanes, state.sessionReadDedup, state.sessionFileMtimes]) {
      expect([...map.keys()]).toEqual([agentLaneKey(survivorAddress)])
    }
  })

  test('eviction removes all three stores for one lane, preserving its colleague', () => {
    const state = createRuntimeState(testWork())
    const first = ensureSessionStores(state, a)
    const second = ensureSessionStores(state, b)
    first.readDedup.record('file', undefined, 'bytes', 'read-a')
    evictSessionStateOverCap(state, 1)
    expect(first.readDedup.lastCallId('file', undefined)).toBeUndefined()
    expect(state.contextLanes.get(agentLaneKey(b))).toBe(second.context)
    expect(ensureSessionStores(state, a).context).not.toBe(first.context)
  })

  test('address keys survive serialization and cannot collide at identifier delimiters', () => {
    expect(agentLaneKey(JSON.parse(JSON.stringify(a)))).toBe(agentLaneKey(a))
    expect(agentLaneKey({ sessionId: 'x,y', agentId: 'z' })).not.toBe(
      agentLaneKey({ sessionId: 'x', agentId: 'y,z' }),
    )
    expect(() => agentLaneKey({ sessionId: 's', agentId: '' })).toThrow('incomplete')
  })

  test('a session named like another lane key cannot delete that lane', () => {
    const state = createRuntimeState(testWork())
    const own = ensureSessionStores(state, a)
    const unusual = { sessionId: agentLaneKey(a), agentId: 'other' }
    ensureSessionStores(state, unusual)
    forgetSessionRuntimeState(state, unusual.sessionId)
    expect(state.contextLanes.get(agentLaneKey(a))).toBe(own.context)
    expect(state.contextLanes.has(agentLaneKey(unusual))).toBe(false)
  })
})
