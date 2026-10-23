import { describe, expect, test } from 'bun:test'
import { killProcessTree, type ProcessSignals } from './process-tree'

/**
 * The escalation after the grace, decided without real processes: which of the group or the pid
 * is still alive is an input, the timer fires at once, and every signal sent is recorded. The
 * real-process cases live in `process-tree.integration.test.ts`.
 */
function signals(alive: { group: boolean; pid: boolean }, failGroupKill = false) {
  const sent: string[] = []
  const deps: ProcessSignals = {
    platform: 'darwin',
    kill: (target, signal) => {
      if (failGroupKill && target < 0 && signal === 'SIGKILL') throw new Error('ESRCH')
      sent.push(`${signal} ${target}`)
    },
    isAlive: (target) => (target < 0 ? alive.group : alive.pid),
    afterGrace: (run) => run(),
    taskkill: () => sent.push('taskkill'),
  }
  return { sent, deps }
}

describe('killProcessTree escalation', () => {
  test('a group that outlives the grace is SIGKILLed as a group', () => {
    const { sent, deps } = signals({ group: true, pid: true })
    killProcessTree(42, 10, undefined, deps)
    expect(sent).toEqual(['SIGTERM -42', 'SIGKILL -42'])
  })

  test('when the group is gone but the pid lives on, the pid alone is SIGKILLed', () => {
    const { sent, deps } = signals({ group: false, pid: true })
    killProcessTree(42, 10, undefined, deps)
    expect(sent).toEqual(['SIGTERM -42', 'SIGKILL 42'])
  })

  test('a group kill that fails falls back to the pid', () => {
    const { sent, deps } = signals({ group: true, pid: true }, true)
    killProcessTree(42, 10, undefined, deps)
    expect(sent).toEqual(['SIGTERM -42', 'SIGKILL 42'])
  })

  test('a tree already gone after the grace gets nothing more', () => {
    const { sent, deps } = signals({ group: false, pid: false })
    killProcessTree(42, 10, undefined, deps)
    expect(sent).toEqual(['SIGTERM -42'])
  })

  test('an escalation the caller says is no longer ours is never sent', () => {
    const { sent, deps } = signals({ group: true, pid: true })
    killProcessTree(42, 10, () => false, deps)
    expect(sent).toEqual(['SIGTERM -42'])
  })
})

describe('killProcessTree on Windows', () => {
  function windows(alive: boolean) {
    const calls: string[] = []
    const deps: ProcessSignals = {
      platform: 'win32',
      kill: () => calls.push('kill'),
      isAlive: () => alive,
      afterGrace: (run) => run(),
      taskkill: (pid, force) => calls.push(`taskkill ${pid}${force ? ' /F' : ''}`),
    }
    return { calls, deps }
  }

  test('asks the tree to end, then forces it when it outlives the grace', () => {
    const { calls, deps } = windows(true)
    killProcessTree(42, 10, undefined, deps)
    expect(calls).toEqual(['taskkill 42', 'taskkill 42 /F'])
  })

  test('a tree gone after the grace, or no longer ours, is not forced', () => {
    const gone = windows(false)
    killProcessTree(42, 10, undefined, gone.deps)
    expect(gone.calls).toEqual(['taskkill 42'])
    const notOurs = windows(true)
    killProcessTree(42, 10, () => false, notOurs.deps)
    expect(notOurs.calls).toEqual(['taskkill 42'])
  })
})
