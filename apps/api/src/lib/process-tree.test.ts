import { describe, expect, test } from 'bun:test'
import { stillRunning } from './process-tree'

/**
 * The escalation predicate. `killProcessTree` itself sends real signals on a timer, so what
 * is worth pinning is the rule it consults — and specifically the asymmetry, which is the
 * whole reason the predicate exists.
 */
describe('stillRunning', () => {
  test('a running child says yes', () => {
    expect(stillRunning({ exitCode: null })()).toBe(true)
  })

  test('a child that exited says no — including on exit code 0', () => {
    expect(stillRunning({ exitCode: 0 })()).toBe(false)
    expect(stillRunning({ exitCode: 137 })()).toBe(false)
  })

  test('it is read at CALL time, not captured', () => {
    // The point of a predicate rather than a boolean: the process exits DURING the grace
    // window, which is exactly the window a captured value would have missed.
    const child: { exitCode: number | null } = { exitCode: null }
    const predicate = stillRunning(child)
    expect(predicate()).toBe(true)
    child.exitCode = 0
    expect(predicate()).toBe(false)
  })

  test('no information means assume running, so a process we started is never leaked', () => {
    // Asymmetric on purpose: refusing to kill leaks a process of ours, while killing a
    // recycled pid reaches into a stranger's.
    expect(stillRunning({})()).toBe(true)
    expect(stillRunning(undefined)()).toBe(true)
    expect(stillRunning(null)()).toBe(true)
  })
})
