import { describe, expect, test } from 'bun:test'
import { buildWithheldToolsSection } from './withheld'
import { TOOL } from '../../tool-names'
import { ACTIVATE_TOOLS_TOOL_NAME } from '../../tool-names-reserved'
import type { ToolLedger } from '../../tool-ledger'

const EMPTY: ToolLedger = new Map()
const withCron: ToolLedger = new Map([
  [
    TOOL.Loops,
    {
      state: 'withheld' as const,
      reason: { layer: 'policy' as const, kind: 'rule' as const, denial: null },
      remedy: { remedyId: 'tool.enable' as const, target: TOOL.Loops },
    },
  ],
])

describe('the unavailable section', () => {
  test('is absent for a run that cannot propose anything', () => {
    // Naming a remedy to a run without `configure` is a pointer to nothing.
    expect(buildWithheldToolsSection(withCron, [], ['office'])).toBeNull()
  })

  test('is absent when there is nothing to say', () => {
    expect(buildWithheldToolsSection(EMPTY, [TOOL.Configure], [])).toBeNull()
  })

  test('names a plugin waiting on consent, and admits its tools are unknown', () => {
    // The honest claim: the plugin is here and nobody has said yes. What it would contribute
    // cannot be listed, because listing it would mean importing the code the question is
    // about — a manifest declares entry files, not tool names.
    const section = buildWithheldToolsSection(EMPTY, [TOOL.Configure, TOOL.Store], ['office'])
    expect(section).toContain('plugin "office"')
    expect(section).toContain('its tools are unknown until it is')
    // The remedy is the Store's now: a configure proposal for a plugin no longer exists.
    expect(section).not.toContain('plugin.enable')
    expect(section).toContain('`Store`')
  })

  test('a waiting plugin alone is enough to render the section', () => {
    // It does not ride the ledger — nothing about it reached the tool registry — so the
    // section has to be reachable without a single withheld tool.
    expect(buildWithheldToolsSection(EMPTY, [TOOL.Configure], ['office'])).not.toBeNull()
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
    const ledger = new Map([row(TOOL.Loops), row(TOOL.GlobalSearch)] as never) as ToolLedger
    const section = buildWithheldToolsSection(ledger, [TOOL.Configure])!
    const lines = section.split('\n').filter((line) => line.startsWith('- '))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Loops, GlobalSearch')
    expect(lines[0]).toContain(
      'Configure {action:"propose", change:{kind:"tool.enable", name:"<tool>"}}',
    )
  })

  test('with `Configure` behind `ToolSearch`, the remedy says to load it first', () => {
    const deferred: ToolLedger = new Map([
      ...withCron,
      [TOOL.Configure, { state: 'deferred' as const, source: 'Localix' }],
    ])
    const section = buildWithheldToolsSection(deferred, [ACTIVATE_TOOLS_TOOL_NAME])!
    expect(section).toContain('- Loops — ')
    expect(section).toContain('load `Configure` with `ToolSearch` ("select:Configure")')
  })

  test('withheld tools and waiting plugins appear together, tools first', () => {
    const section = buildWithheldToolsSection(withCron, [TOOL.Configure], ['office'])!
    expect(section.indexOf('Loops')).toBeLessThan(section.indexOf('plugin "office"'))
  })

  test('without the Store the user is told to switch a waiting plugin on there', () => {
    const section = buildWithheldToolsSection(EMPTY, [TOOL.Configure], ['office'], ['tasks'])!
    expect(section).not.toContain('`Store`')
    expect(section).toContain('mini app "tasks"')
    expect(section).toContain('ask the user to switch it on in the Store')
  })
})
