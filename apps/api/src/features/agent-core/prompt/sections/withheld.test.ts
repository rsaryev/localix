import { describe, expect, test } from 'bun:test'
import { buildWithheldToolsSection } from './withheld'
import { TOOL } from '../../tool-names'
import type { ToolLedger } from '../../tool-ledger'

const EMPTY: ToolLedger = new Map()
const withCron: ToolLedger = new Map([
  [
    TOOL.loops,
    {
      state: 'withheld' as const,
      reason: { layer: 'policy' as const, kind: 'rule' as const, denial: null },
      remedy: { remedyId: 'tool.enable' as const, target: TOOL.loops },
    },
  ],
])

describe('the unavailable section', () => {
  test('is absent for a run that cannot propose anything', () => {
    // Naming a remedy to a run without `configure` is a pointer to nothing.
    expect(buildWithheldToolsSection(withCron, [], ['office'])).toBeNull()
  })

  test('is absent when there is nothing to say', () => {
    expect(buildWithheldToolsSection(EMPTY, [TOOL.configure], [])).toBeNull()
  })

  test('names a plugin waiting on consent, and admits its tools are unknown', () => {
    // The honest claim: the plugin is here and nobody has said yes. What it would contribute
    // cannot be listed, because listing it would mean importing the code the question is
    // about — a manifest declares entry files, not tool names.
    const section = buildWithheldToolsSection(EMPTY, [TOOL.configure, TOOL.store], ['office'])
    expect(section).toContain('plugin "office"')
    expect(section).toContain('its tools are unknown until it is')
    // The remedy is the Store's now: a configure proposal for a plugin no longer exists.
    expect(section).not.toContain('plugin.enable')
    expect(section).toContain('`store`')
  })

  test('a waiting plugin alone is enough to render the section', () => {
    // It does not ride the ledger — nothing about it reached the tool registry — so the
    // section has to be reachable without a single withheld tool.
    expect(buildWithheldToolsSection(EMPTY, [TOOL.configure], ['office'])).not.toBeNull()
  })

  test('tools withheld for the same reason share one line and one remedy', () => {
    // One line per tool repeated the reason and the remedy template for every entry.
    const row = (name: string) => [
      name,
      {
        state: 'withheld' as const,
        reason: { layer: 'policy' as const, kind: 'rule' as const, denial: null },
        remedy: { remedyId: 'tool.enable' as const, target: name },
      },
    ]
    const ledger = new Map([row(TOOL.loops), row(TOOL.memory)] as never) as ToolLedger
    const section = buildWithheldToolsSection(ledger, [TOOL.configure])!
    const lines = section.split('\n').filter((line) => line.startsWith('- '))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(`${TOOL.loops}, ${TOOL.memory}`)
    expect(lines[0]).toContain('name:"<tool>"')
  })

  test('withheld tools and waiting plugins appear together, tools first', () => {
    const section = buildWithheldToolsSection(withCron, [TOOL.configure], ['office'])!
    expect(section.indexOf(TOOL.loops)).toBeLessThan(section.indexOf('plugin "office"'))
  })

  test('without the Store the user is told to switch a waiting plugin on there', () => {
    const section = buildWithheldToolsSection(EMPTY, [TOOL.configure], ['office'], ['kanban'])!
    expect(section).not.toContain('`store`')
    expect(section).toContain('mini app "kanban"')
    expect(section).toContain('ask the user to switch it on in the Store')
  })
})
