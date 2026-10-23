import { describe, expect, test } from 'bun:test'
import { testWork } from '../../../testing/work-fixture'
import type { SessionRecord } from '../repository'
import {
  createRuntimeState,
  forgetSessionRuntimeState,
  snapshotBackgroundJobs,
} from './agent-runner-state'

const startJob = (
  state: ReturnType<typeof createRuntimeState>,
  toolCallId: string,
  sessionId: string,
) =>
  state.work.start({
    owner: { userId: 'u', sessionId },
    agentId: null,
    kind: 'job',
    label: 'sleep 99',
    toolCallId,
    messageId: null,
  })

describe('createRuntimeState', () => {
  test('initializes every runtime container empty', () => {
    const s = createRuntimeState(testWork())
    expect(s.activeRuns.size).toBe(0)
    expect(s.activeRunSessions.size).toBe(0)
    expect(s.stoppedRuntimeSessionIds.size).toBe(0)
    expect(s.miniAppStartedSessions.size).toBe(0)
    expect(s.actionRegistry.size).toBe(0)
    expect(s.work.owners()).toEqual([])
    expect(s.childRuntimeSessions.size).toBe(0)
    expect(s.drainingSessions.size).toBe(0)
    expect(s.liveItemResolvers.size).toBe(0)
  })

  test('returns fresh, INDEPENDENT containers per call (no aliasing across instances)', () => {
    // The maps are shared process-wide by passing ONE instance around — not by
    // aliasing across calls. If a container ever became module-level shared, two
    // instances would leak into each other (the cross-session-jobs bug class).
    const a = createRuntimeState(testWork())
    const b = createRuntimeState(testWork())
    startJob(a, 'job1', 's')
    a.stoppedRuntimeSessionIds.add('sess-x')
    expect(b.work.owners()).toEqual([])
    expect(b.stoppedRuntimeSessionIds.size).toBe(0)
  })
})

describe('snapshotBackgroundJobs', () => {
  test('carries the backend terminal id into the reconnect snapshot', () => {
    const state = createRuntimeState(testWork())
    startJob(state, 'call-1', 's')
    state.work.setTerminal('call-1', 'pty-1')
    expect(snapshotBackgroundJobs(state.work, 'u', 's')).toMatchObject([
      { toolCallId: 'call-1', jobId: 'bg-1', terminalId: 'pty-1', command: 'sleep 99' },
    ])
  })

  test("another session's work is never in the snapshot", () => {
    const state = createRuntimeState(testWork())
    startJob(state, 'mine', 's')
    startJob(state, 'theirs', 'other')
    expect(snapshotBackgroundJobs(state.work, 'u', 's').map((job) => job.toolCallId)).toEqual([
      'mine',
    ])
  })
})

describe('forgetSessionRuntimeState', () => {
  const rec = (id: string) => ({ id }) as unknown as SessionRecord

  test('reaps every process-lifetime entry for the deleted session only', () => {
    const s = createRuntimeState(testWork())
    let deadKills = 0
    let aliveKills = 0
    const deadLifecycle = { forgotten: false }
    s.actionRegistry.set('job-dead', {
      userId: 'u',
      sessionId: 'dead',
      lifecycle: deadLifecycle,
      actions: {
        kill: { label: 'Kill', execute: () => void (deadKills += 1) },
      },
    })
    s.actionRegistry.set('job-alive', {
      userId: 'u',
      sessionId: 'alive',
      actions: {
        kill: { label: 'Kill', execute: () => void (aliveKills += 1) },
      },
    })
    startJob(s, 'job-dead', 'dead')
    startJob(s, 'job-alive', 'alive')
    s.miniAppStartedSessions.add('dead')
    s.miniAppStartedSessions.add('alive')
    s.contextSnapshots.set('dead', 'boundary', { marker: 'stale' } as never)
    s.contextSnapshots.set('alive', 'boundary', { marker: 'fresh' } as never)
    s.childRuntimeSessions.set('dead', {
      userId: 'u',
      parentSessionId: 'p',
      toolCallId: 't',
      session: rec('dead'),
    })
    s.childRuntimeSessions.set('alive', {
      userId: 'u',
      parentSessionId: 'p',
      toolCallId: 't2',
      session: rec('alive'),
    })
    s.drainingSessions.add('dead')
    s.terminalWaits.set('pty-dead', {
      userId: 'u',
      sessionId: 'dead',
      terminalId: 'pty-dead',
    })
    s.terminalWaits.set('pty-alive', {
      userId: 'u',
      sessionId: 'alive',
      terminalId: 'pty-alive',
    })
    forgetSessionRuntimeState(s, 'dead')

    // dead session is fully reaped
    expect(s.miniAppStartedSessions.has('dead')).toBe(false)
    expect(s.actionRegistry.has('job-dead')).toBe(false)
    expect(s.work.get('job-dead')).toBeUndefined()
    expect(deadLifecycle.forgotten).toBe(true)
    expect(deadKills).toBe(1)
    expect(s.contextSnapshots.get('dead', 'boundary')).toBeUndefined()
    expect(s.childRuntimeSessions.has('dead')).toBe(false)
    expect(s.drainingSessions.has('dead')).toBe(false)
    expect(s.terminalWaits.has('pty-dead')).toBe(false)
    // unrelated session untouched
    expect(s.miniAppStartedSessions.has('alive')).toBe(true)
    expect(s.actionRegistry.has('job-alive')).toBe(true)
    expect(s.work.get('job-alive')).toBeDefined()
    expect(aliveKills).toBe(0)
    expect(s.contextSnapshots.get('alive', 'boundary')).toBeDefined()
    expect(s.childRuntimeSessions.has('alive')).toBe(true)
    expect(s.terminalWaits.has('pty-alive')).toBe(true)
  })

  test('is a no-op for a session with no entries', () => {
    const s = createRuntimeState(testWork())
    s.miniAppStartedSessions.add('other')
    forgetSessionRuntimeState(s, 'ghost')
    expect(s.miniAppStartedSessions.has('other')).toBe(true)
  })

  test('continues terminal cleanup when one background kill action throws', () => {
    const s = createRuntimeState(testWork())
    s.actionRegistry.set('broken-job', {
      userId: 'u',
      sessionId: 'dead',
      actions: {
        kill: {
          label: 'Kill',
          execute: () => {
            throw new Error('adapter teardown failed')
          },
        },
      },
    })
    startJob(s, 'broken-job', 'dead')
    s.miniAppStartedSessions.add('dead')

    expect(() => forgetSessionRuntimeState(s, 'dead')).not.toThrow()
    expect(s.actionRegistry.has('broken-job')).toBe(false)
    expect(s.work.get('broken-job')).toBeUndefined()
    expect(s.miniAppStartedSessions.has('dead')).toBe(false)
  })
})
