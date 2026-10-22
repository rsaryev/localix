import { expect, test } from 'bun:test'
import { createSafeConsole, formatted } from './safe-console'

/** The `console` a mod gets: text only, each line cut, and a flood dropped. */

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

test('lines are cut, and past the window the rest are dropped with one note', () => {
  let now = 0
  const lines: string[] = []
  const console = createSafeConsole({
    print: (level, line) => void lines.push(`${level} ${line}`),
    now: () => now,
    limits: { lineChars: 5, lines: 2, windowMs: 1000 },
  })
  console.log('abcdefgh')
  console.error('x', { y: 1 })
  console.log('dropped, said once')
  console.log('dropped')
  now = 1000
  console.count()
  expect(lines).toEqual([
    'log abcde… (3 more)',
    'error x {"y… (4 more)',
    'error [mod] console: more than 2 lines; some dropped',
    'log defau… (5 more)',
  ])
})
