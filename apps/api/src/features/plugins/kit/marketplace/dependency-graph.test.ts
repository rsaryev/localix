import { describe, expect, it } from 'bun:test'

import {
  declaredDependencies,
  disableRefusal,
  enableCascade,
  uninstallRequiredBy,
  type PluginNode,
} from './dependency-graph'
import { installedRecord } from './install-closure'

/**
 * Enabling and disabling a plugin that is part of a dependency graph, judged by the kit
 * (`enablePlan`, `disableDecision`): an enable turns on the installed dependencies that are off,
 * dependencies first, and fails on one that is not installed; a disable is refused while an enabled
 * plugin still needs it. Localix knows a plugin by its name.
 */

const node = (name: string, enabled: boolean, dependencies: unknown[] = []): PluginNode => ({
  name,
  enabled,
  dependencies,
})

describe('enableCascade', () => {
  it('turns on the dependencies that are off, each after its own', () => {
    const plugins = [
      node('app', false, ['lib', { name: 'util', version: '^1.0.0' }]),
      node('lib', false, ['base@mkt']),
      node('base', false),
      node('util', true),
    ]
    expect(enableCascade('app', plugins)).toEqual({ enable: ['base', 'lib'], issues: [] })
  })
})

describe('disableRefusal', () => {
  it('names the enabled plugins that still need it, in the order to disable them', () => {
    const plugins = [node('app', true, ['lib']), node('lib', true), node('off', false, ['lib'])]
    expect(disableRefusal('lib', plugins)).toBe(
      'Cannot disable "lib": "app" depends on it; disable it first',
    )
    expect(disableRefusal('app', plugins)).toBeUndefined()
  })
})

describe('declaredDependencies', () => {
  it('parses the CC union (string | {name, version?}), deduped, invalid dropped', () => {
    expect(
      declaredDependencies([
        'helper-lib',
        { name: 'pinned', version: '^2.0.0' },
        { name: 'helper-lib', version: '9.9.9' }, // duplicate — first wins
        '', // invalid
        { version: '1.0.0' } as never, // no name
        42 as never,
      ]),
    ).toEqual([{ name: 'helper-lib' }, { name: 'pinned', range: '^2.0.0' }])
  })
  it('returns [] for absent/non-array input', () => {
    expect(declaredDependencies(undefined)).toEqual([])
    expect(declaredDependencies({} as never)).toEqual([])
  })
})

describe('uninstallRequiredBy', () => {
  it("names the enabled plugins that depend on it, at the scope (the kit's requiredBy)", () => {
    const record = (id: string, deps: string[] = []) =>
      installedRecord({ id, scope: 'user', manifest: { dependencies: deps } })
    const facts = {
      installed: [record('a@m', ['lib']), record('off@m', ['lib']), record('lib@m')],
      enabled: { user: { 'a@m': true, 'off@m': false, 'lib@m': true } },
    }
    expect(uninstallRequiredBy('lib@m', 'user', facts)).toEqual(['a'])
    expect(uninstallRequiredBy('nope@m', 'user', facts)).toEqual([])
  })
})
