import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { warnOnDivergingMessagePrefix, warnOnVolatileCachePrefix } from './cache-volatility-guard'

describe('warnOnVolatileCachePrefix', () => {
  const spies: Array<{ mockRestore: () => void }> = []
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore()
  })

  const spy = () => {
    const s = spyOn(console, 'warn').mockImplementation(() => {})
    spies.push(s)
    return s
  }

  /**
   * Only THIS guard's warnings. `console.warn` is process-wide and `bun test` runs
   * every file in one process, so a spy's window also collects whatever other suites'
   * pending async work logs — `not.toHaveBeenCalled()` failed here under
   * `--randomize` on someone else's line, not on a regression in the guard.
   */
  const volatileWarnings = (warn: ReturnType<typeof spy>): unknown[][] =>
    warn.mock.calls.filter((call) => String(call[0]).includes('[cache] session'))

  test('clean prefix → no warning', () => {
    const warn = spy()
    warnOnVolatileCachePrefix('s-clean', '# Identity\nStable rules. Date: 2026-07-02')
    expect(volatileWarnings(warn)).toHaveLength(0)
  })

  test('volatile prefix → warns once, then stays silent for the same prefix', () => {
    const warn = spy()
    const prefix = `# Identity\nGenerated at 2026-07-02T10:15:00 for this turn`
    warnOnVolatileCachePrefix('s-volatile', prefix)
    warnOnVolatileCachePrefix('s-volatile', prefix)
    warnOnVolatileCachePrefix('s-volatile', prefix)
    const warnings = volatileWarnings(warn)
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0][0])).toContain('volatile token')
  })

  test('a CHANGED volatile prefix warns again (each leak is a distinct regression)', () => {
    const warn = spy()
    warnOnVolatileCachePrefix('s-changing', 'turn at 2026-07-02T10:15:00')
    warnOnVolatileCachePrefix('s-changing', 'turn at 2026-07-02T10:16:00')
    expect(volatileWarnings(warn)).toHaveLength(2)
  })

  test('stable replayed message bytes → no warning', () => {
    const warn = spy()
    const turnN = [
      { id: 'u-stable', payload: { role: 'user', content: 'turn N' } },
      {
        id: 'runtime-context-a-stable',
        payload: { role: 'user', content: 'volatile A', isInternal: true },
      },
    ]
    warnOnDivergingMessagePrefix('s-message-stable', turnN)
    warnOnDivergingMessagePrefix('s-message-stable', [
      turnN[0]!,
      { id: 'a-stable', payload: { role: 'assistant', content: 'done' } },
      { id: 'u-stable-2', payload: { role: 'user', content: 'turn N+1' } },
      {
        id: 'runtime-context-a-stable-2',
        payload: { role: 'user', content: 'volatile B', isInternal: true },
      },
    ])
    expect(volatileWarnings(warn)).toHaveLength(0)
  })

  test('diverging replayed message bytes → warns', () => {
    const warn = spy()
    warnOnDivergingMessagePrefix('s-message-diverged', [
      {
        id: 'u-diverged',
        payload: { role: 'user', content: '# Runtime context\nvolatile\n\nturn N' },
      },
    ])
    warnOnDivergingMessagePrefix('s-message-diverged', [
      { id: 'u-diverged', payload: { role: 'user', content: 'turn N' } },
      { id: 'a-diverged', payload: { role: 'assistant', content: 'done' } },
      { id: 'u-diverged-2', payload: { role: 'user', content: 'turn N+1' } },
    ])
    const warnings = volatileWarnings(warn)
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0][0])).toContain('message prefix diverged')
  })
})
