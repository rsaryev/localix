import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../../repository'
import { dispatchParams } from '../run-params'
import { reenterRun } from './reenter-run'
import type { RunEnv, RunParams, RunScope } from './types'

const session = { id: 's1', sessionKind: 'chat' } as SessionRecord
const params = dispatchParams(
  { userId: 'u1', session, historyMessages: [], assistantMessageId: 'a1' },
  {
    speakerAgentId: 'agent-1',
    executionContext: { invocation: { kind: 'root' } } as unknown as RunScope['executionContext'],
    maxTurns: 3,
  },
)

function envWith(run: (p: RunParams) => Promise<unknown>, holder?: AbortController) {
  const activeRuns = new Map<string, AbortController>()
  const activeRunSessions = new Map<string, unknown>()
  if (holder) {
    activeRuns.set('s1', holder)
    activeRunSessions.set('s1', { userId: 'u1', session })
  }
  const env = { state: { activeRuns, activeRunSessions }, run } as unknown as RunEnv
  return { env, activeRuns, activeRunSessions }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('reenterRun', () => {
  test('releases the lease it holds and re-enters with the scope carried whole', async () => {
    const abort = new AbortController()
    let seen: RunParams | undefined
    const h = envWith(async (p) => {
      seen = p
    }, abort)
    reenterRun({
      env: h.env,
      params,
      abort,
      reason: 'test',
      turn: {},
      chain: { checkpointRecovered: true },
    })
    expect(h.activeRuns.size).toBe(0)
    expect(h.activeRunSessions.size).toBe(0)
    await settle()
    expect(seen?.scope.maxTurns).toBe(3)
    expect(seen?.chain.checkpointRecovered).toBe(true)
    expect(seen?.chain.continuation).toBe(true)
  })

  test('leaves a lease it does not hold alone — a newer run may own it', async () => {
    const other = new AbortController()
    let launched = false
    const h = envWith(async () => {
      launched = true
    }, other)
    expect(
      reenterRun({ env: h.env, params, abort: new AbortController(), reason: 'test', turn: {} }),
    ).toBe(false)
    expect(h.activeRuns.get('s1')).toBe(other)
    expect(launched).toBe(false)
  })

  test('Stop at the handoff keeps the lease and never creates another run', () => {
    const abort = new AbortController()
    let launched = false
    const h = envWith(async () => {
      launched = true
    }, abort)
    abort.abort('stop')
    expect(reenterRun({ env: h.env, params, abort, reason: 'test', turn: {} })).toBe(false)
    expect(h.activeRuns.get('s1')).toBe(abort)
    expect(launched).toBe(false)
  })

  test('a rejecting relaunch is reported, never left unhandled', async () => {
    const warnings: unknown[][] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      const h = envWith(() => Promise.reject(new Error('relaunch failed')))
      reenterRun({ env: h.env, params, reason: 'compaction', turn: {} })
      await settle()
    } finally {
      console.warn = original
    }
    expect(warnings.flat().some((arg) => String(arg).includes('compaction relaunch failed'))).toBe(
      true,
    )
  })
})
