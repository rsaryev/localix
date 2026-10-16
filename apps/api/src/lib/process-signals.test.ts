import { describe, expect, test } from 'bun:test'
import { installServerSignalHandlers, type ShutdownSignal } from './process-signals'

const SIGNALS: readonly ShutdownSignal[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

describe('standalone API signal lifecycle', () => {
  for (const signal of SIGNALS) {
    test(`${signal} drains exactly once and exits successfully`, async () => {
      const baseline = Object.fromEntries(
        SIGNALS.map((name) => [name, process.listenerCount(name)]),
      )
      let stops = 0
      const exits: number[] = []
      let releaseStop!: () => void
      const stopped = new Promise<void>((resolve) => {
        releaseStop = resolve
      })
      const uninstall = installServerSignalHandlers(
        async () => {
          stops += 1
          await stopped
        },
        { exit: (code) => exits.push(code) },
      )

      process.emit(signal)
      process.emit(signal)
      releaseStop()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(stops).toBe(1)
      expect(exits).toEqual([0])
      uninstall()
      for (const name of SIGNALS) expect(process.listenerCount(name)).toBe(baseline[name])
    })
  }

  test('reports a teardown failure and exits non-zero', async () => {
    const errors: unknown[] = []
    const exits: number[] = []
    const uninstall = installServerSignalHandlers(
      async () => {
        throw new Error('dispose failed')
      },
      { exit: (code) => exits.push(code), reportError: (error) => errors.push(error) },
    )
    process.emit('SIGTERM')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(errors).toHaveLength(1)
    expect(exits).toEqual([1])
    uninstall()
  })
})
