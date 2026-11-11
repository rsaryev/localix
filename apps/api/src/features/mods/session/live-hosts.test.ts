import { expect, test } from 'bun:test'
import { INERT_MOD_PORTS, type ModSource } from '../contracts'
import { failuresOf, keyOf, reportLine } from './live-hosts'

const source = (plugin: string): ModSource => ({
  plugin,
  root: `/p/${plugin}`,
  module: `/p/${plugin}/hooks/register.js`,
  options: {},
  revision: '1',
})

test('a conversation is keyed by its session; a project with none by its directory', () => {
  expect(keyOf({ userId: 'u', sessionId: 's1', cwd: '/w' })).toBe('s1')
  expect(keyOf({ userId: 'u', cwd: '/w' })).toBe('workspace:/w')
})

test('a kit line is reported under the mod it names, its name said once', () => {
  const reports: string[] = []
  const ports = {
    ...INERT_MOD_PORTS,
    report: (plugin: string, line: string) => void reports.push(`${plugin}|${line}`),
  }
  reportLine(ports, 'm: event hook skipped: threw Error: x', ['m'])
  reportLine(ports, 'the hooks modules loaded', ['m'])
  expect(reports).toEqual(['m|event hook skipped: threw Error: x', 'mods|the hooks modules loaded'])
})

test('a mod that did not load fails with the line that names it', () => {
  const failures = failuresOf([source('a'), source('b'), source('c')], {
    loaded: [{ name: 'a' }],
    lines: ['b: hooks module did not load: nope'],
  })
  expect(failures).toEqual(
    new Map([
      ['b', 'b: hooks module did not load: nope'],
      ['c', 'its hooks module did not load'],
    ]),
  )
})
