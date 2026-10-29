import { describe, expect, test } from 'bun:test'
import { composerTips } from './tips'
import { CURATED_TIPS, TEACHABLE_COMMANDS } from './tips-curated'
import { SLASH_COMMANDS } from '../chat/slash-catalog'
import { tipKeywordPattern } from './tips-keywords'
import { TIP_SIGNALS } from './tip-contracts'
import type { CapabilitySnapshot } from '../../contracts/capability-snapshot'
import type { PluginRecord } from '../plugins/contracts'
import type { MiniAppRecord } from '../mini-apps/contracts'
import { parseLocalixUri } from '@localixai/mini-app-sdk/navigation'
import { BUILTIN_TOOL_CATALOG } from '../agent-core/tool-names'

const tipsOf = (snapshot: Parameters<typeof composerTips>[0]) =>
  composerTips(snapshot, SLASH_COMMANDS)

/** Every builtin tool enabled — the scope in which no capability gate can hide a tip. */
const ALL_TOOLS = Object.values(BUILTIN_TOOL_CATALOG).map((tool) => tool.name)

type TipInput = Omit<CapabilitySnapshot, 'tips'>

function plugin(over: Partial<PluginRecord> & { name: string; enabled: boolean }): PluginRecord {
  return {
    version: '1.0.0',
    description: '',
    projectId: '',
    scope: 'global',
    dir: `/plugins/${over.name}`,
    source: 'local',
    provides: { skills: [], mcpServers: [], commands: [] },
    config: [],
    validation: { errors: [], warnings: [] },
    ...over,
  } as PluginRecord
}

function miniApp(over: Partial<MiniAppRecord> & { name: string; enabled: boolean }): MiniAppRecord {
  return {
    description: '',
    surfaces: ['agent'],
    scope: 'global',
    projectId: '',
    dir: `/mini-apps/${over.name}`,
    hasBackend: false,
    tools: [],
    backendSubsystems: [],
    commands: [],
    views: [],
    hasGuide: false,
    config: [],
    ...over,
  }
}

function snapshot(over: Partial<TipInput> = {}): TipInput {
  return {
    revision: 1,
    scope: { projectId: '', agentId: null },
    plugins: [],
    miniApps: [],
    miniAppCommands: [],
    tools: {
      enabled: [],
      disabled: [],
      catalog: [],
      categoryLabels: {},
      mcp: [],
      mcpUnprobedServers: [],
    },
    views: [],
    themes: [],
    agents: [],
    commands: [],
    mcp: [],
    skills: [],
    grammar: { kinds: [], effects: [], classes: [], examples: [] },
    ...over,
  }
}

const ids = (tips: { id: string }[]) => tips.map((tip) => tip.id)

describe('composerTips — curated tips follow the tool surface', () => {
  test('a tip about a denied tool is not shipped', () => {
    const tips = tipsOf(snapshot())
    expect(ids(tips)).not.toContain('bash-background')
  })

  test('the same tip ships once its tool is enabled', () => {
    const tips = tipsOf(snapshot({ tools: { ...snapshot().tools, enabled: ['Bash'] } }))
    expect(ids(tips)).toContain('bash-background')
  })

  test('an ungated product tip always ships', () => {
    expect(ids(tipsOf(snapshot()))).toContain('queue-while-running')
  })

  test('the gate never reaches the wire', () => {
    const gated = CURATED_TIPS.find((tip) => tip.requiresAnyTool)
    expect(gated).toBeDefined()
    const tips = tipsOf(
      snapshot({ tools: { ...snapshot().tools, enabled: [...(gated?.requiresAnyTool ?? [])] } }),
    )
    const shipped = tips.find((tip) => tip.id === gated?.id)
    expect(shipped).toBeDefined()
    expect(shipped).not.toHaveProperty('requiresAnyTool')
  })
})

describe('composerTips — the pool is derived from this scope', () => {
  test('an installed-but-off plugin is offered, gated on its own words', () => {
    const tips = tipsOf(
      snapshot({
        plugins: [
          plugin({
            name: 'browser-drive',
            source: 'browser-drive@localix',
            displayName: 'Browser Drive',
            enabled: false,
            description: 'Drive a real browser to click through pages. Screenshots included.',
          }),
        ],
      }),
    )
    const tip = tips.find((t) => t.id === 'plugin:browser-drive')
    expect(tip?.text).toContain('Browser Drive')
    // One sentence, not the whole description.
    expect(tip?.text).not.toContain('Screenshots')
    // The quick action lands on that plugin's own Store page, not on the plugins list.
    expect(tip?.actions?.[0]).toMatchObject({ kind: 'navigate' })
    expect(tip?.actions?.[0].kind === 'navigate' ? tip.actions[0].uri : '').toBe(
      'localix://ui/work-item/store?kind=plugin&id=browser-drive%40localix',
    )
    expect(new RegExp(tip?.when?.textPattern ?? '$^', 'i').test('drive the browser for me')).toBe(
      true,
    )
    expect(new RegExp(tip?.when?.textPattern ?? '$^', 'i').test('rename this variable')).toBe(false)
  })

  test('an installed-but-off mini app is offered with its own name and its own Store page', () => {
    const tips = tipsOf(
      snapshot({
        miniApps: [
          miniApp({
            name: 'tabletop',
            displayName: 'Tabletop',
            enabled: false,
            description: 'Play tabletop games against the agent. Legal moves only.',
          }),
        ],
      }),
    )
    const tip = tips.find((t) => t.id === 'mini-app:tabletop')
    expect(tip?.text).toContain('the "Tabletop" mini app')
    expect(tip?.text).not.toMatch(/plugin/iu)
    expect(tip?.actions?.[0].kind === 'navigate' ? tip.actions[0].uri : '').toContain(
      'work-item/store?kind=mini-app&id=tabletop',
    )
    expect(new RegExp(tip?.when?.textPattern ?? '$^', 'i').test('a tabletop game?')).toBe(true)
  })

  test('an enabled plugin is not advertised as something to enable', () => {
    const tips = tipsOf(
      snapshot({
        // A synthetic name, not a bundled plugin's: core must not know one, and the rule under
        // test is about the ENABLED flag, which any plugin row carries.
        plugins: [plugin({ name: 'containers', enabled: true, description: 'Containers.' })],
      }),
    )
    expect(ids(tips)).not.toContain('plugin:containers')
  })

  test('a broken plugin is not advertised at all', () => {
    const tips = tipsOf(
      snapshot({
        plugins: [
          plugin({ name: 'broken', enabled: false, description: 'X.', error: 'bad manifest' }),
        ],
      }),
    )
    expect(ids(tips)).not.toContain('plugin:broken')
  })

  test('plugin commands and skills become insertable tips', () => {
    const tips = tipsOf(
      snapshot({
        commands: [
          {
            pluginName: 'git',
            name: 'stage',
            fullName: 'git:stage',
            description: 'Stage the changed files.',
            args: [],
          },
        ],
        skills: [
          {
            id: 's1',
            enabled: true,
            name: 'deploy',
            description: 'Ship the service.',
            tags: [],
            projectId: '',
            scope: 'global',
            source: 'db',
            updatedAt: '',
          },
        ],
      }),
    )
    expect(tips.find((t) => t.id === 'command:git:stage')?.actions).toEqual([
      { kind: 'insert', label: '/git:stage', text: '/git:stage' },
    ])
    // A skill gets both halves of what a user wants with it: run it, or go edit it.
    const skillTip = tips.find((t) => t.id === 'skill:deploy')
    expect(skillTip?.actions?.[0]).toEqual({ kind: 'insert', label: '/deploy', text: '/deploy' })
    expect(skillTip?.actions?.[1]).toMatchObject({ kind: 'navigate' })
  })

  test('a skill the scope switched off is not taught', () => {
    const tips = tipsOf(
      snapshot({
        skills: [
          {
            id: 's1',
            enabled: false,
            name: 'deploy',
            description: 'Ship the service.',
            tags: [],
            projectId: '',
            scope: 'global',
            source: 'db',
            updatedAt: '',
          },
        ],
      }),
    )
    expect(ids(tips)).not.toContain('skill:deploy')
  })

  test('onboarding lines appear only while their catalog is empty', () => {
    expect(ids(tipsOf(snapshot()))).toContain('onboarding:skills')
    const withSkill = tipsOf(
      snapshot({
        skills: [
          {
            id: 's1',
            enabled: true,
            name: 'deploy',
            description: 'Ship it.',
            tags: [],
            projectId: '',
            scope: 'global',
            source: 'db',
            updatedAt: '',
          },
        ],
      }),
    )
    expect(ids(withSkill)).not.toContain('onboarding:skills')
  })

  test('ids are unique — the client keys its seen-counts by them', () => {
    const duplicated = plugin({ name: 'same', enabled: false, description: 'Two scopes.' })
    const tips = tipsOf(
      snapshot({ plugins: [duplicated, { ...duplicated, projectId: 'p1', scope: 'project' }] }),
    )
    expect(new Set(ids(tips)).size).toBe(tips.length)
  })
})

describe('composerTips — built-in commands are derived, not retyped', () => {
  test('a taught command takes its text from the shared catalog', () => {
    const spec = SLASH_COMMANDS.find((command) => command.name === TEACHABLE_COMMANDS[0])
    expect(spec).toBeDefined()
    const tip = tipsOf(snapshot()).find((t) => t.id === `builtin:${spec?.name}`)
    expect(tip?.actions).toEqual([
      { kind: 'insert', label: `/${spec?.name}`, text: `/${spec?.name}` },
    ])
    // Derived from the catalog's own words, so renaming the command renames the tip.
    expect(tip?.text).toContain(spec?.description.slice(0, 20) ?? '')
  })

  test('every teachable name exists in the catalog — a stale one is dead weight', () => {
    const known = new Set(SLASH_COMMANDS.filter((command) => !command.hidden).map((c) => c.name))
    expect(TEACHABLE_COMMANDS.filter((name) => !known.has(name))).toEqual([])
  })

  test('a hidden or untaught command produces no tip', () => {
    const ids = new Set(tipsOf(snapshot()).map((tip) => tip.id))
    for (const command of SLASH_COMMANDS) {
      if (command.hidden || !TEACHABLE_COMMANDS.includes(command.name)) {
        expect(ids.has(`builtin:${command.name}`)).toBe(false)
      }
    }
  })
})

describe('composerTips — session tips ship with their gates intact', () => {
  test('every signal a tip names is one the client knows', () => {
    const named = new Set<string>()
    for (const tip of tipsOf(snapshot({ tools: { ...snapshot().tools, enabled: ALL_TOOLS } }))) {
      for (const signal of tip.when?.signals ?? []) named.add(signal)
      for (const signal of tip.when?.notSignals ?? []) named.add(signal)
    }
    expect(named.size).toBeGreaterThan(0)
    for (const signal of named)
      expect(TIP_SIGNALS).toContain(signal as (typeof TIP_SIGNALS)[number])
  })
})

describe('composerTips — quick actions', () => {
  test('every navigate action is a destination the navigation layer can parse', () => {
    const tips = tipsOf(
      snapshot({
        tools: { ...snapshot().tools, enabled: ALL_TOOLS },
        plugins: [plugin({ name: 'off-one', enabled: false, description: 'Does a thing.' })],
      }),
    )
    const uris = tips.flatMap((tip) =>
      (tip.actions ?? []).flatMap((action) => (action.kind === 'navigate' ? [action.uri] : [])),
    )
    expect(uris.length).toBeGreaterThan(0)
    // A tip's button is dropped on the client when its URI does not resolve, so a
    // malformed one fails silently there. Parsing here is what makes it fail loudly.
    // Both namespaces are destinations: a settings surface, or a registered resource.
    for (const uri of uris) {
      const primitive = parseLocalixUri(uri)?.primitive ?? ''
      expect(['ui', 'resource'].includes(primitive)).toBe(true)
    }
  })

  test('a tip carries at most two actions — the band is not a toolbar', () => {
    const tips = tipsOf(snapshot({ tools: { ...snapshot().tools, enabled: ALL_TOOLS } }))
    for (const tip of tips) expect(tip.actions?.length ?? 0).toBeLessThanOrEqual(2)
  })
})

describe('tipKeywordPattern', () => {
  test('drops stopwords and short words', () => {
    expect(tipKeywordPattern('the api with plugins')).toBeUndefined()
  })

  // The failure this guards: "Create and edit spreadsheets" firing its plugin's tip
  // on "create a function". A description's NOUNS say what it is about.
  test('manifest boilerplate verbs never become a trigger', () => {
    const pattern = new RegExp(
      tipKeywordPattern('Create and edit spreadsheets and presentations.') ?? '$^',
      'i',
    )
    expect(pattern.test('create a function')).toBe(false)
    // Singular and plural both hit: the manifest says "spreadsheets", people type
    // "spreadsheet", and a keyword that only matched its own form would lose most
    // of the requests it exists for.
    expect(pattern.test('fix the spreadsheet export')).toBe(true)
    expect(pattern.test('two spreadsheets to merge')).toBe(true)
  })

  test('escapes what a manifest may legally contain', () => {
    const pattern = tipKeywordPattern('c++ (notes)')
    expect(() => new RegExp(pattern ?? '', 'i')).not.toThrow()
  })
})
