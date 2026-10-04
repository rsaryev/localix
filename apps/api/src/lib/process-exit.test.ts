import { describe, expect, test } from 'bun:test'

import { isTerminationSignalExit } from './process-exit'

describe('isTerminationSignalExit', () => {
  test('graceful STOP signals (128+N) are terminations', () => {
    expect(isTerminationSignalExit(129)).toBe(true) // SIGHUP
    expect(isTerminationSignalExit(130)).toBe(true) // SIGINT (^C)
    expect(isTerminationSignalExit(137)).toBe(true) // SIGKILL
    expect(isTerminationSignalExit(143)).toBe(true) // SIGTERM (hot-reload kills the group)
  })

  test('CRASH signals are NOT terminations (they are real failures)', () => {
    expect(isTerminationSignalExit(132)).toBe(false) // SIGILL
    expect(isTerminationSignalExit(134)).toBe(false) // SIGABRT
    expect(isTerminationSignalExit(139)).toBe(false) // SIGSEGV
  })

  test('clean and ordinary error exits are not terminations', () => {
    expect(isTerminationSignalExit(0)).toBe(false)
    expect(isTerminationSignalExit(1)).toBe(false)
    expect(isTerminationSignalExit(2)).toBe(false)
    expect(isTerminationSignalExit(124)).toBe(false) // GNU timeout — handled separately
  })

  test('missing exit code is not a termination', () => {
    expect(isTerminationSignalExit(null)).toBe(false)
    expect(isTerminationSignalExit(undefined)).toBe(false)
    expect(isTerminationSignalExit(-1)).toBe(false)
  })
})
