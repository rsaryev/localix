import { expect, test } from 'bun:test'
import { narrowLoadedPlugins } from './narrow'
import type { LoadedPlugins } from './loader'

const skill = (name: string, pluginName?: string) =>
  ({ name, pluginName }) as LoadedPlugins['skills'][number]
const server = (id: string, name: string) => ({ id, name }) as LoadedPlugins['mcpServers'][number]

/** Two plugins that do not exist, on purpose: this is about attribution, not about any one of ours. */
const DENIED = 'first-fixture'
const KEPT = 'second-fixture'

function loadedFixture(): LoadedPlugins {
  return {
    binDirs: [`/plugins/${DENIED}/bin`, `/plugins/${KEPT}/bin`],
    mcpServers: [
      server(`plugin:${DENIED}:docs`, `${DENIED}_docs`),
      server(`plugin:${KEPT}:feed`, `${KEPT}_feed`),
    ],
    skills: [skill('write-memo', DENIED), skill('read-chart', KEPT), skill('local-only')],
    ccHooks: [],
    lspServers: [],
    monitors: [],
    agents: [
      { pluginName: DENIED, name: 'clerk' },
      { pluginName: KEPT, name: 'analyst' },
    ],
    outputStyles: [
      { pluginName: DENIED, fullName: `${DENIED}:terse` },
      { pluginName: KEPT, fullName: `${KEPT}:plain` },
    ],
    // The denied plugin's default agent would otherwise run this agent's chat.
    mainAgent: { pluginName: DENIED, name: 'clerk' },
    awaitingConsent: [],
    loaded: [
      {
        name: DENIED,
        scope: 'global',
        description: '',
        skills: ['write-memo'],
        mcpServers: ['docs'],
        binDir: `/plugins/${DENIED}/bin`,
      },
      {
        name: KEPT,
        scope: 'global',
        description: '',
        skills: ['read-chart'],
        mcpServers: ['feed'],
        binDir: `/plugins/${KEPT}/bin`,
      },
    ],
  } as unknown as LoadedPlugins
}

test('a denied plugin contributes nothing to the run', () => {
  const narrowed = narrowLoadedPlugins(loadedFixture(), [DENIED])

  expect(narrowed.skills.map((s) => s.name)).toEqual(['read-chart', 'local-only'])
  expect(narrowed.mcpServers.map((s) => s.id)).toEqual([`plugin:${KEPT}:feed`])
  expect(narrowed.binDirs).toEqual([`/plugins/${KEPT}/bin`])
  expect(narrowed.agents.map((a) => a.pluginName)).toEqual([KEPT])
  expect(narrowed.outputStyles.map((s) => s.pluginName)).toEqual([KEPT])
  expect(narrowed.mainAgent).toBeNull()
  expect(narrowed.loaded.map((p) => p.name)).toEqual([KEPT])
})

test('an allowed plugin keeps every contribution — the positive control', () => {
  const before = loadedFixture()
  const narrowed = narrowLoadedPlugins(before, ['not-installed'])

  expect(narrowed).toBe(before)
  expect(narrowLoadedPlugins(before, [])).toBe(before)
})

/**
 * A skill that never recorded its owner must survive: the filesystem walk contributes skills
 * no plugin shipped, and dropping those would let one plugin denial empty a user's own roster.
 */
test('an unattributed skill is never subtracted', () => {
  const narrowed = narrowLoadedPlugins(loadedFixture(), [DENIED, KEPT])

  expect(narrowed.skills.map((s) => s.name)).toEqual(['local-only'])
})
