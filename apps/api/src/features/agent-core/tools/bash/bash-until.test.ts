import { describe, expect, it } from 'bun:test'
import type { MonitorEndReason, MonitorEvent, MonitorSpec } from '../../../monitors/contracts'
import { runUntilWait, type BashWaitHost } from './bash-until'

function fakeHost() {
  const calls: MonitorSpec[] = []
  let hooks:
    | { onEvents?: (e: MonitorEvent[]) => void; onEnd?: (r: MonitorEndReason, d?: string) => void }
    | undefined
  const host: BashWaitHost = {
    async start(_toolCallId, spec, h) {
      calls.push(spec)
      hooks = h
      return { ok: true, id: 'mon-1', label: spec.description }
    },
    stop: () => true,
  }
  return { host, calls, end: (r: MonitorEndReason) => hooks?.onEnd?.(r, undefined) }
}

describe('bash until → wait spec', () => {
  it('polls the command with exit_zero on the model interval and the background deadline', async () => {
    const { host, calls } = fakeHost()
    const result = await runUntilWait(
      { host },
      'call-1',
      { command: 'curl -sf localhost:3000', until: 5, timeout: 120 },
      '/cwd',
      120,
      undefined,
      undefined,
    )
    expect(calls[0]).toMatchObject({
      description: 'curl -sf localhost:3000',
      cwd: '/cwd',
      timeoutMs: 120_000,
      until: {
        check: 'curl -sf localhost:3000',
        everySeconds: 5,
        when: { kind: 'exit_zero' },
        emit: 'once',
      },
    })
    expect(result.content).toContain('Wait mon-1 started')
    expect(result.content).toContain('every 5s')
    expect(result.content).toContain('END YOUR TURN')
  })

  it('clamps an interval that mirrors the deadline so the wait can actually fire', async () => {
    // Live-observed: `until: 300, timeout: 300` — one poll, exactly at the deadline.
    const { host, calls } = fakeHost()
    const result = await runUntilWait(
      { host },
      'call-1',
      { command: 'test -f ready.flag', until: 300, timeout: 300 },
      '/cwd',
      300,
      undefined,
      undefined,
    )
    expect(calls[0]!.until!.everySeconds).toBe(75)
    expect(result.content).toContain('interval lowered from 300s')
    // No description → the command names the wait.
    expect(calls[0]!.description).toBe('test -f ready.flag')
  })

  it('uses the engine default deadline when background has no timeout', async () => {
    const { host, calls } = fakeHost()
    await runUntilWait(
      { host },
      'c',
      { command: 'true', until: 10 },
      '/cwd',
      0,
      undefined,
      undefined,
    )
    expect(calls[0]!.timeoutMs).toBe(300_000)
  })

  it('books only a met condition as a completed job', async () => {
    const { host, end } = fakeHost()
    const emitted: Array<{ jobStatus?: string; exitCode?: number; done?: boolean }> = []
    const context = {
      asyncRegistry: {
        emitBackground: (
          _id: string,
          _out: string,
          opts: { jobStatus?: string; exitCode?: number; done?: boolean },
        ) => {
          emitted.push(opts)
        },
        registerActions: () => () => {},
      },
    } as never
    await runUntilWait({ host }, 'c', { command: 'true', until: 5 }, '/cwd', 0, undefined, context)
    end('timeout')
    expect(emitted.at(-1)).toMatchObject({ done: true, jobStatus: 'timeout', exitCode: 1 })
  })

  it('surfaces a refused start as a tool error', async () => {
    const host: BashWaitHost = {
      start: async () => ({ ok: false, error: 'Vault key MISSING is not set' }),
      stop: () => true,
    }
    const result = await runUntilWait(
      { host },
      'c',
      { command: 'x', until: 5 },
      '/cwd',
      0,
      undefined,
      undefined,
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('MISSING')
  })
})
