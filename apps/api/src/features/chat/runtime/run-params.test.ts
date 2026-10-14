/**
 * The carry-forward contract: a re-entered segment inherits its scope WHOLE and its chain
 * whole-then-patched. Each case below is a bug that shipped when the five re-entry paths
 * hand-listed the fields they carried.
 */
import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../repository'
import { createRunCompletion } from './run-outcome'
import {
  dispatchParams,
  freshChain,
  identityOf,
  identityOutlivesRun,
  mergeIdentity,
  reenterParams,
} from './run-params'
import type { RunScope } from './run/types'

const session = { id: 's1', sessionKind: 'chat' } as SessionRecord
const authority = {
  invocation: { kind: 'root' },
  authority: { capabilities: [] },
} as unknown as RunScope['executionContext']

const fullScope: RunScope = {
  speakerAgentId: 'agent-1',
  executionContext: authority,
  profileOverride: { id: 'worker' } as unknown as RunScope['profileOverride'],
  extraDisabledTools: ['bash'],
  extraAllowedTools: ['read'],
  maxTurns: 7,
  ccScopedHooks: [{ raw: {}, source: 'agent', asSubagent: true }],
}

const turn = { userId: 'u1', session, historyMessages: [], assistantMessageId: 'a1' }

describe('dispatchParams', () => {
  test('carries an explicit speaker without reordering the conversation roster', () => {
    const addressedSession = {
      ...session,
      agents: [
        { agentId: 'alpha', handle: 'alpha' },
        { agentId: 'beta', handle: 'beta' },
      ],
    } as SessionRecord
    const params = dispatchParams(
      { ...turn, session: addressedSession },
      { ...fullScope, speakerAgentId: 'beta' },
    )

    expect(params.scope.speakerAgentId).toBe('beta')
    expect(params.session).toBe(addressedSession)
    expect(params.session.agents.map((agent) => agent.agentId)).toEqual(['alpha', 'beta'])
  })

  test('snapshots mandatory tools and preserves them through identity capture and reentry', () => {
    const requiredTools = [{ name: 'report', resources: ['complete'] }]
    const params = dispatchParams(turn, { ...fullScope, requiredTools })
    requiredTools[0]!.resources.length = 0
    requiredTools[0]!.name = 'other'
    requiredTools.length = 0
    expect(params.scope.requiredTools).toEqual([{ name: 'report', resources: ['complete'] }])
    expect(Object.isFrozen(params.scope.requiredTools)).toBe(true)
    expect(Object.isFrozen(params.scope.requiredTools![0])).toBe(true)
    expect(Object.isFrozen(params.scope.requiredTools![0]!.resources)).toBe(true)
    expect(reenterParams(params, {}).scope.requiredTools).toBe(params.scope.requiredTools)
    const remembered = identityOf(params.scope)
    expect(remembered.requiredTools).toEqual([{ name: 'report', resources: ['complete'] }])
    expect(remembered.requiredTools).not.toBe(params.scope.requiredTools)
    expect(Object.isFrozen(remembered.requiredTools)).toBe(true)
  })

  test('wakes accumulate mandatory tools even when their candidate roster narrows', () => {
    const requiredTools = [{ name: 'report', resources: ['complete'] }]
    const merged = mergeIdentity(
      { requiredTools, hostTools: ['read', 'report'] },
      {
        requiredTools: [{ name: 'recover' }, { name: 'report', resources: ['block', 'complete'] }],
        hostTools: ['read'],
      },
    )
    requiredTools.length = 0
    const expected = [{ name: 'report', resources: ['complete', 'block'] }, { name: 'recover' }]
    expect(merged.requiredTools).toEqual(expected)
    expect(merged.hostTools).toEqual(['read'])
    expect(Object.isFrozen(merged.requiredTools)).toBe(true)
    expect(mergeIdentity(merged, { requiredTools: [] }).requiredTools).toEqual(expected)
    expect(mergeIdentity(merged, { requiredTools: undefined }).requiredTools).toEqual(expected)
    expect(mergeIdentity(merged, { requiredTools: [{ name: 'report' }] }).requiredTools).toEqual(
      expected,
    )
  })

  test('snapshots host tools before callers can mutate them and carries the snapshot on reentry', () => {
    const tools = ['read']
    const scope = { ...fullScope, hostTools: tools }
    const params = dispatchParams(turn, scope)
    tools.push('write')
    scope.hostTools = ['bash']
    expect(params.scope.hostTools).toEqual(['read'])
    expect(Object.isFrozen(params.scope.hostTools)).toBe(true)
    expect(reenterParams(params, {}).scope.hostTools).toBe(params.scope.hostTools)
  })

  test('a fresh dispatch starts with an untouched chain', () => {
    const params = dispatchParams(turn, fullScope)
    expect(params.chain).toEqual(freshChain())
    expect(params.chain.continuation).toBe(false)
    expect(params.scope).toBe(fullScope)
  })

  test('the wake queue can hand a logical completion to the first segment', () => {
    const completion = createRunCompletion()
    expect(dispatchParams(turn, fullScope, completion).chain.completion).toBe(completion)
  })
})

describe('reenterParams', () => {
  test('a fresh topic epoch survives retries after its boundary row has been cut from history', () => {
    const params = dispatchParams({ ...turn, contextBoundaryId: 'topic-change' }, fullScope)
    const retry = reenterParams(params, { assistantMessageId: 'retry' }, { transientRetryCount: 1 })
    expect(retry.contextBoundaryId).toBe('topic-change')
    expect(reenterParams(retry, {}).contextBoundaryId).toBe('topic-change')
  })
  test('carries every scope field — the sub-agent turn cap and skill grants included', () => {
    const next = reenterParams(dispatchParams(turn, fullScope), {})
    // The three fields continuations used to drop.
    expect(next.scope.maxTurns).toBe(7)
    expect(next.scope.extraAllowedTools).toEqual(['read'])
    expect(next.scope.extraDisabledTools).toEqual(['bash'])
    // And the two they remembered to carry.
    expect(next.scope.profileOverride).toBe(fullScope.profileOverride)
    expect(next.scope.ccScopedHooks).toBe(fullScope.ccScopedHooks)
    expect(next.scope.executionContext).toBe(authority)
  })

  test('patching one chain field never refills another budget', () => {
    const spent = {
      ...dispatchParams(turn, fullScope),
      chain: { ...freshChain(), checkpointRecovered: true, transientRetryCount: 2 },
    }
    const next = reenterParams(spent, {}, { hookStopContinuationCount: 1 })
    expect(next.chain.checkpointRecovered).toBe(true)
    expect(next.chain.transientRetryCount).toBe(2)
    expect(next.chain.hookStopContinuationCount).toBe(1)
  })

  test('a re-entered segment is always a continuation, whatever the patch says', () => {
    const next = reenterParams(dispatchParams(turn, fullScope), {})
    expect(next.chain.continuation).toBe(true)
  })

  test('the turn patch replaces only what it names', () => {
    const params = dispatchParams(turn, fullScope)
    const next = reenterParams(params, { assistantMessageId: 'a2' })
    expect(next.assistantMessageId).toBe('a2')
    expect(next.session).toBe(session)
    expect(next.historyMessages).toBe(params.historyMessages)
    expect(next.userId).toBe('u1')
  })
})

describe('remembered identity', () => {
  test.each([
    { before: ['read'], incoming: ['read', 'write'], expected: ['read'] },
    { before: ['read', 'write'], incoming: ['write'], expected: ['write'] },
    { before: ['read'], incoming: ['write'], expected: [] },
    { before: [], incoming: ['write'], expected: [] },
    { before: ['read'], incoming: [], expected: [] },
    { before: ['read'], incoming: undefined, expected: ['read'] },
    { before: undefined, incoming: ['write'], expected: ['write'] },
  ])('wake host tools only narrow: $before / $incoming', ({ before, incoming, expected }) => {
    const remembered: string[] | undefined = before ? [...before] : undefined
    const supplied: string[] | undefined = incoming ? [...incoming] : undefined
    const merged = mergeIdentity({ hostTools: remembered }, { hostTools: supplied })
    expect(merged.hostTools).toEqual(expected)
    expect(Object.isFrozen(merged.hostTools)).toBe(true)
    remembered?.push('bash')
    supplied?.push('edit')
    expect(merged.hostTools).toEqual(expected)
  })

  test('remembering identity isolates the roster from a mutable source scope', () => {
    const tools = ['read']
    const identity = identityOf({ ...fullScope, hostTools: tools })
    tools.push('write')
    expect(identity.hostTools).toEqual(['read'])
    expect(Object.isFrozen(identity.hostTools)).toBe(true)
  })

  test('only a job/subagent session keeps its identity for later wakes', () => {
    expect(identityOutlivesRun({ sessionKind: 'job' })).toBe(true)
    expect(identityOutlivesRun({ sessionKind: 'subagent' })).toBe(true)
    expect(identityOutlivesRun({ sessionKind: 'chat' })).toBe(false)
  })

  test('identityOf strips the authority — a wake re-derives it', () => {
    const identity = identityOf(fullScope)
    expect(identity).not.toHaveProperty('executionContext')
    expect(identity.profileOverride).toBe(fullScope.profileOverride)
    expect(identity.maxTurns).toBe(7)
  })

  test("mergeIdentity keeps the remembered role and adds the wake's restrictions", () => {
    const merged = mergeIdentity(identityOf(fullScope), { extraDisabledTools: ['bash', 'write'] })
    expect(merged.profileOverride).toBe(fullScope.profileOverride)
    expect(merged.extraDisabledTools).toEqual(['bash', 'write'])
    expect(merged.extraAllowedTools).toEqual(['read'])
  })

  test('mergeIdentity with nothing remembered is just the wake restrictions', () => {
    expect(mergeIdentity(undefined, { extraDisabledTools: ['bash'] })).toEqual({
      extraDisabledTools: ['bash'],
    })
    expect(mergeIdentity(undefined, {})).toEqual({})
  })
})
