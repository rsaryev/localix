import { describe, expect, test } from 'bun:test'

import { adoptChildBgProc, childBgProc } from './bash-process'
import { spawnToResult } from '../environments/spawn'
import { createBashTool } from './bash'
import { FAST_SETTLE } from './test-settle'

/**
 * A background bash job is over when THE COMMAND is over.
 *
 * The bug these lock: `childBgProc.exited` resolved only on `'close'`, which fires
 * only once every inherited stdio descriptor is closed — and anything the command
 * spawned inherited them too. A command that leaves a daemon behind exits at once
 * while that daemon holds our stdout pipe, so the job's completion promise never
 * settled: the job reported "running" forever, never emitted `done`, never notified,
 * and its Kill could not settle it either (a daemon that called `setsid` has left our
 * process group, so `kill(-pid)` cannot reach it). Measured before the fix: a job
 * whose command exited in 5ms was still un-settled 10s later.
 *
 * `'close'` still WINS when it arrives (the normal case — nobody else holds the
 * pipes), so no output is ever truncated.
 */

const HOLDER_LIFETIME_S = 5
const SETTLE_BUDGET_MS = 2_000

/** A command that exits immediately, leaving a pipe-holder behind. */
const escapedGrandchild = `perl -e "setpgrp; sleep ${HOLDER_LIFETIME_S}" & echo started; exit 0`
const samePgroupChild = `sleep ${HOLDER_LIFETIME_S} & echo started; exit 0`

async function settleMs(
  command: string,
): Promise<{ ms: number; code: number | null; output: string }> {
  const started = Date.now()
  const proc = childBgProc(command, process.cwd())
  let output = ''
  proc.onOutput((chunk) => {
    output += chunk
  })
  const code = await proc.exited
  return { ms: Date.now() - started, code, output }
}

describe('background job: settled by the command, not by whoever holds its pipes', () => {
  test('a command that leaves an ESCAPED daemon holding stdout still completes', async () => {
    // The daemon called setsid: it is out of our process group, so `kill(-pid)`
    // can never reach it. Before the fix this job could not be completed OR killed.
    const { ms, code, output } = await settleMs(escapedGrandchild)
    expect(code).toBe(0)
    expect(output).toContain('started') // nothing the command wrote is lost
    expect(ms).toBeLessThan(SETTLE_BUDGET_MS) // before the fix: HOLDER_LIFETIME_S
  }, 15_000)

  test('a command that backgrounds a child with `&` still completes', async () => {
    const { ms, code } = await settleMs(samePgroupChild)
    expect(code).toBe(0)
    expect(ms).toBeLessThan(SETTLE_BUDGET_MS)
  }, 15_000)

  test('a command with no pipe-holder settles on close — immediately, with all its output', async () => {
    const { ms, code, output } = await settleMs('echo one; echo two; exit 3')
    expect(code).toBe(3)
    expect(output).toContain('one')
    expect(output).toContain('two')
    expect(ms).toBeLessThan(500) // 'close' wins; the drain window is never spent
  }, 10_000)

  test('a long-running command does NOT settle early — the job stays alive', async () => {
    const proc = childBgProc(`echo up; sleep ${HOLDER_LIFETIME_S}`, process.cwd())
    const outcome = await Promise.race([
      proc.exited.then(() => 'settled' as const),
      new Promise<'still-running'>((r) => setTimeout(() => r('still-running'), 1_000)),
    ])
    proc.kill()
    expect(outcome).toBe('still-running')
  }, 10_000)

  test('the background job reports done — even when a daemon keeps the pipe open', async () => {
    // The job-level consequence: `emitBackground(..., done: true)` is what removes the
    // job from the jobs list, fires `notify`, and returns the final output to the model.
    const tool = createBashTool(undefined, undefined, { backgroundSettle: FAST_SETTLE })
    let doneAt: number | null = null
    const started = Date.now()
    const context = {
      asyncRegistry: {
        registerActions: () => () => {},
        emitBackground: (_id: string, _text: string, meta?: { done?: boolean }) => {
          if (meta?.done && doneAt === null) doneAt = Date.now() - started
        },
        getBackgroundJobId: () => 'job-1',
      },
    } as never

    await tool.execute(
      'bg-hostage',
      { command: escapedGrandchild, background: true },
      undefined,
      undefined,
      context,
    )
    // The tool returns from its settle window; the job finalizes on its own.
    await new Promise((r) => setTimeout(r, 1_500))
    expect(doneAt).not.toBeNull() // before the fix: never — a permanently "running" phantom job
    expect(doneAt!).toBeLessThan(SETTLE_BUDGET_MS + 1_000)
  }, 20_000)
})

describe('adoptChildBgProc', () => {
  test.skipIf(process.platform === 'win32')(
    'replays the foreground capture, then resumes the live stream',
    async () => {
      const handover = await spawnToResult(
        'bash',
        ['-c', 'echo before; sleep 0.4; echo after; sleep 30'],
        { timeout: 0.2, onTimeout: 'detach' },
      )
      const detached = handover.detached!
      const proc = adoptChildBgProc(detached.child, detached.stdout)

      let seen = ''
      // The FIRST listener gets the pre-handover buffer ahead of any live chunk, so
      // promotion never costs the model the lines the command already printed.
      proc.onOutput((chunk) => {
        seen += chunk
      })
      expect(seen).toContain('before')

      const deadline = Date.now() + 3_000
      while (Date.now() < deadline && !seen.includes('after')) await Bun.sleep(10)
      expect(seen).toContain('after')

      proc.kill()
      expect(await proc.exited).not.toBeUndefined()
    },
  )

  test.skipIf(process.platform === 'win32')(
    'an adopted job settles on the command exiting',
    async () => {
      const handover = await spawnToResult('bash', ['-c', 'echo hi; sleep 0.5'], {
        timeout: 0.15,
        onTimeout: 'detach',
      })
      const detached = handover.detached!
      const proc = adoptChildBgProc(detached.child, detached.stdout)
      proc.onOutput(() => {})

      expect(await proc.exited).toBe(0)
    },
  )
})
