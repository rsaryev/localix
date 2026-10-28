import { expect, test } from 'bun:test'
import { RunAdmission, runtimeRunAdmission } from './run-admission'
import { createRuntimeState } from './agent-runner-state'
import { testWork } from '../../../testing/work-fixture'
import { executeRun } from './run/execute-run'
import type { RunEnv } from './run/types'
import { sessionFixture } from '../../../testing/session-fixture'
import { dispatchParams } from './run-params'
import { sessionExecutionContext } from './execution-context'

test('teardown revokes pending admission even after its barrier is released', async () => {
  const admission = new RunAdmission()
  const pending = admission.enter('s')
  await admission.quiesce(['s'], async () => {
    expect(() => admission.enter('s')).toThrow('being deleted')
    expect(() => pending.assertValid()).toThrow('revoked')
    const other = admission.enter('other')
    other.assertValid()
    other.release()
  })
  expect(() => pending.assertValid()).toThrow('revoked')
  pending.release()
  pending.release()
  const fresh = admission.enter('s')
  fresh.assertValid()
  fresh.release()
})

test('nested barriers and failures restore admission only after the outer barrier ends', async () => {
  const admission = new RunAdmission()
  await expect(
    admission.quiesce(['s'], async () => {
      await admission.quiesce(['s'], async () => {})
      expect(() => admission.enter('s')).toThrow('being deleted')
      throw new Error('cleanup failed')
    }),
  ).rejects.toThrow('cleanup failed')
  const retry = admission.enter('s')
  retry.assertValid()
  retry.release()
})

test('a run suspended on ancestry cannot register after overlapping teardown', async () => {
  const state = createRuntimeState(testWork())
  let releaseSnapshot!: () => void
  const snapshot = new Promise<[]>((resolve) => {
    releaseSnapshot = () => resolve([])
  })
  const env = {
    state,
    repo: { listRunSessionSnapshotRows: () => snapshot },
  } as unknown as RunEnv
  const session = sessionFixture({ id: 'child', userId: 'u', parentSessionId: 'parent' })
  const params = dispatchParams(
    { userId: 'u', session, historyMessages: [], assistantMessageId: 'assistant' },
    { executionContext: sessionExecutionContext(session) },
  )
  const pending = executeRun(env, params)
  await runtimeRunAdmission(state).quiesce(['child'], async () => {})
  releaseSnapshot()
  await expect(pending).rejects.toThrow('admission was revoked')
  expect(state.activeRuns.size).toBe(0)
  expect(state.activeRunSessions.size).toBe(0)
})
