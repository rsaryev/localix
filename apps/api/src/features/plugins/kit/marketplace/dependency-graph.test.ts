import { describe, expect, it } from 'bun:test'

import { disableRefusal, enableCascade, type PluginNode } from './dependency-graph'

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

  it('fails on a dependency that is not installed, enabling nothing', () => {
    const plugins = [node('app', false, ['lib', 'gone']), node('lib', false)]
    const plan = enableCascade('app', plugins)
    expect(plan.enable).toEqual([])
    expect(plan.issues).toEqual([
      'Dependency "gone" is not installed; install it first: claude plugin install gone',
    ])
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
