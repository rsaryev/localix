import { describe, expect, it } from 'bun:test'
import { planEnableCascade } from './dependencies-enable'
import type { DiscoveredPlugin } from './discovery'

function fakePlugin(over: {
  name: string
  dependencies?: Array<string | { name: string; version?: string }>
}): DiscoveredPlugin {
  return {
    manifest: { name: over.name, description: '', dependencies: over.dependencies } as never,
    dir: `/plugins/${over.name}`,
    scope: 'global',
    projectId: '',
    entrypoints: {} as never,
    provides: { skills: [], mcpServers: [], commands: [] },
    commands: [],
    agents: [],
  }
}

describe('planEnableCascade', () => {
  const plan = (root: DiscoveredPlugin, discovered: DiscoveredPlugin[], on: Set<string>) => {
    const result = planEnableCascade(root, discovered, (p) => on.has(p.manifest.name))
    return { enable: result.enable.map((p) => p.manifest.name), issues: result.issues }
  }

  it('enables installed-but-disabled dependencies', () => {
    const root = fakePlugin({ name: 'parent', dependencies: ['lib'] })
    const lib = fakePlugin({ name: 'lib' })
    expect(plan(root, [root, lib], new Set(['parent']))).toEqual({ enable: ['lib'], issues: [] })
  })

  it('is cycle-safe (a ↔ b) and cascades transitively', () => {
    const a = fakePlugin({ name: 'a', dependencies: ['b'] })
    const b = fakePlugin({ name: 'b', dependencies: ['a'] })
    expect(plan(a, [a, b], new Set()).enable).toEqual(['b'])
  })

  it('fails on a dependency that is not installed, enabling nothing', () => {
    const root = fakePlugin({ name: 'parent', dependencies: ['lib', 'ghost'] })
    const lib = fakePlugin({ name: 'lib' })
    const result = plan(root, [root, lib], new Set(['parent']))
    expect(result.enable).toEqual([])
    expect(result.issues.join(' ')).toContain('"ghost" is not installed')
  })
})
