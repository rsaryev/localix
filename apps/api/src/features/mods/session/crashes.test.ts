import { expect, test } from 'bun:test'
import type { ModSource } from '../contracts'
import { createCrashes } from './crashes'

const source = (revision = '1'): ModSource => ({
  plugin: 'm',
  root: '/p',
  module: '/p/hooks/register.js',
  options: {},
  revision,
})

test('a mod that died starts again on its next event; a second death within a minute waits first', () => {
  let at = 0
  const crashes = createCrashes(() => at)
  expect(crashes.died(source(), 'exited')).toBe(
    'the hooks module exited; it starts again on its next event',
  )
  expect(crashes.benched(source())).toBe(false)
  at = 10_000
  expect(crashes.died(source(), 'exited')).toBe(
    'the hooks module exited; it starts again on its next event after 1 s',
  )
  expect(crashes.benched(source())).toBe(true)
  at = 11_000
  expect(crashes.benched(source())).toBe(false)
})

test('a third death within the minute stops the mod until the plugin changes', () => {
  let at = 0
  const crashes = createCrashes(() => at)
  crashes.died(source(), 'exited')
  at = 1_000
  crashes.died(source(), 'exited')
  at = 5_000
  const line = crashes.died(source(), 'exited')
  expect(line).toBe(
    'the hooks module exited; it stopped 3 times within 60 s and stays stopped until the plugin changes',
  )
  at = 600_000
  expect(crashes.benched(source())).toBe(true)
  expect(crashes.stopped()).toEqual(new Map([['m', line]]))
  expect(crashes.benched(source('2'))).toBe(false)
  expect(crashes.stopped()).toEqual(new Map())
})

test('deaths a minute apart do not add up', () => {
  let at = 0
  const crashes = createCrashes(() => at)
  crashes.died(source(), 'exited')
  at = 61_000
  expect(crashes.died(source(), 'exited')).toBe(
    'the hooks module exited; it starts again on its next event',
  )
})
