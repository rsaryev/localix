import { expect, test } from 'bun:test'
import { createGuestConsole, formatted } from './console'

/** The `console` a mod gets in its VM: one line of text per call, never a value's own inspect. */

test('a value prints as text, and its own inspect is never run', () => {
  let inspected = false
  const custom = { [Symbol.for('nodejs.util.inspect.custom')]: () => (inspected = true), a: 1 }
  const cycle: Record<string, unknown> = { n: 1 }
  cycle.self = cycle
  expect([formatted(custom), formatted(new Error('e')), formatted(2n), formatted(cycle)]).toEqual([
    '{"a":1}',
    'Error: e',
    '2n',
    '{"n":1,"self":"[Circular]"}',
  ])
  expect(inspected).toBe(false)
})

test('each call is one line at its level; counters and timers read the injected clock', () => {
  let now = 0
  const lines: string[] = []
  const console = createGuestConsole({
    print: (level, line) => void lines.push(`${level} ${line}`),
    now: () => now,
  })
  console.log('a', { b: 1 })
  console.warn('careful')
  console.count()
  console.count()
  console.time('t')
  now = 25
  console.timeEnd('t')
  console.assert(true, 'quiet')
  console.assert(false, 'loud')
  expect(lines).toEqual([
    'log a {"b":1}',
    'error careful',
    'log default: 1',
    'log default: 2',
    'log t: 25ms',
    'error Assertion failed loud',
  ])
})
