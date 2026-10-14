import { describe, it, expect, spyOn, afterEach } from 'bun:test'
import { createGuard } from './terminalGuard'

describe('createGuard', () => {
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  // Count only THIS module's warnings. `console.warn` is process-wide and `bun test`
  // runs every file in one process, so a spy's window also collects whatever other
  // suites' pending async work logs — a raw call count is not this test's alone.
  const guardWarnings = () =>
    warnSpy.mock.calls.filter((call) => String(call[0]).startsWith('[terminal] '))
  afterEach(() => warnSpy.mockClear())

  it('returns the callback result when it does not throw', () => {
    const guard = createGuard()
    expect(guard('ok', () => 41 + 1, -1)).toBe(42)
    expect(guardWarnings()).toHaveLength(0)
  })

  it('swallows a throw and returns the fallback (never re-throws into the parser)', () => {
    const guard = createGuard()
    const run = () =>
      guard(
        'boom',
        () => {
          throw new Error('kaboom')
        },
        true,
      )
    expect(run).not.toThrow()
    expect(run()).toBe(true) // fallback stands in for the aborted computation
  })

  it('warns only ONCE per label, no matter how many times it throws', () => {
    const guard = createGuard()
    for (let i = 0; i < 50; i++)
      guard(
        'flood',
        () => {
          throw new Error('again')
        },
        undefined,
      )
    expect(guardWarnings()).toHaveLength(1)
  })

  it('tracks warn-once independently per label', () => {
    const guard = createGuard()
    guard(
      'a',
      () => {
        throw new Error('a')
      },
      undefined,
    )
    guard(
      'b',
      () => {
        throw new Error('b')
      },
      undefined,
    )
    guard(
      'a',
      () => {
        throw new Error('a')
      },
      undefined,
    )
    expect(guardWarnings()).toHaveLength(2) // one per distinct label
  })

  it('a non-throwing call after a throwing one still returns its real value', () => {
    const guard = createGuard()
    guard(
      'x',
      () => {
        throw new Error('x')
      },
      0,
    )
    expect(guard('x', () => 7, 0)).toBe(7)
  })
})
