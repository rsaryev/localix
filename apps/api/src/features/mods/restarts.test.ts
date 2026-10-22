import { expect, test } from 'bun:test'
import { createModHealth } from './restarts'

/** When a mod whose worker died may start again. */

test('a death restarts at once, the next ones back off, and the third within the window fails', () => {
  let now = 0
  const reports: string[] = []
  const health = createModHealth(
    { deaths: 3, windowMs: 60_000, backoffMs: 1_000 },
    () => now,
    (plugin, message) => reports.push(`${plugin}: ${message}`),
  )
  expect(health.died('m', 'crashed: a')).toBe(false)
  expect(health.mayStart('m')).toBe(true)
  now = 10
  expect(health.died('m', 'crashed: b')).toBe(false)
  expect(health.mayStart('m')).toBe(false)
  now = 1_010
  expect(health.mayStart('m')).toBe(true)
  expect(health.died('m', 'crashed: c')).toBe(true)
  now = 1_000_000
  expect(health.mayStart('m')).toBe(false)
  expect(health.failures.get('m')).toContain('stays stopped until the plugin changes')
  expect(reports).toEqual([
    'm: the hooks module crashed: a; it starts again on its next event',
    'm: the hooks module crashed: b; it starts again on its next event after 1 s',
    'm: the hooks module crashed: c; it stopped 3 times within 60 s and stays stopped until the plugin changes',
  ])
  health.forget('m')
  expect(health.mayStart('m')).toBe(true)
})

test('deaths outside the window count no more', () => {
  let now = 0
  const health = createModHealth(
    { deaths: 2, windowMs: 100, backoffMs: 10 },
    () => now,
    () => {},
  )
  expect(health.died('m', 'exited')).toBe(false)
  now = 500
  expect(health.died('m', 'exited')).toBe(false)
  expect(health.mayStart('m')).toBe(true)
})
