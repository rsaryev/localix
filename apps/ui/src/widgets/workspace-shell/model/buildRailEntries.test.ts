import { describe, expect, it } from 'bun:test'
import { buildRailEntries, type BuildRailEntriesInput } from './buildRailEntries'
import { moveRailItem, resolveRailAreas } from './railLayout'
import type { RailAction, RailSection } from '../ui/shellTypes'

const section = (id: string, extra: Partial<RailSection> = {}): RailSection => ({
  id,
  icon: null,
  label: id,
  content: null,
  ...extra,
})
const action = (id: string, extra: Partial<RailAction> = {}): RailAction => ({
  id,
  icon: null,
  label: id,
  onClick: () => {},
  customizable: true,
  ...extra,
})

const baseInput: BuildRailEntriesInput = {
  railSections: [],
  customizableActions: [],
  sidebarOpen: false,
  activeSection: null,
  onSectionClick: () => {},
}

describe('buildRailEntries', () => {
  it('retains the status label and placement of core controls', () => {
    const { entryMap, defs } = buildRailEntries({
      ...baseInput,
      customizableActions: [
        action('core-cli', {
          statusLabel: 'CLI',
          toolCategory: 'utilities',
          defaultArea: 'status',
        }),
      ],
    })
    expect(entryMap.get('core-cli')?.statusLabel).toBe('CLI')
    expect(entryMap.get('core-cli')?.plugin).toBeUndefined()
    expect(resolveRailAreas(defs, null).status).toEqual(['core-cli'])
  })
  it('namespaces ids and preserves def order (sections → actions)', () => {
    const { defs } = buildRailEntries({
      ...baseInput,
      railSections: [section('files')],
      customizableActions: [action('changes')],
    })
    expect(defs.map((d) => d.id)).toEqual(['section:files', 'changes'])
  })

  it('defaults a section to the bar (or its declared area)', () => {
    const { defs } = buildRailEntries({
      ...baseInput,
      railSections: [section('files'), section('db', { defaultArea: 'overflow' })],
    })
    expect(defs.find((d) => d.id === 'section:files')?.defaultArea).toBe('bar')
    expect(defs.find((d) => d.id === 'section:db')?.defaultArea).toBe('overflow')
  })

  it('defaults an action to overflow when it declares an overflowGroup', () => {
    const { defs } = buildRailEntries({
      ...baseInput,
      customizableActions: [action('a'), action('b', { overflowGroup: 'workspace' })],
    })
    expect(defs.find((d) => d.id === 'a')?.defaultArea).toBe('bar')
    expect(defs.find((d) => d.id === 'b')?.defaultArea).toBe('overflow')
  })

  it('pins every plugin view by default and lets each be unpinned independently', () => {
    const { defs } = buildRailEntries({
      ...baseInput,
      railSections: [section('alpha', { plugin: true, defaultArea: 'bar' })],
      customizableActions: [action('beta:workspace', { plugin: true, defaultArea: 'bar' })],
    })
    for (const id of ['section:alpha', 'beta:workspace']) {
      const def = defs.find((d) => d.id === id)
      expect(def?.defaultArea).toBe('bar')
      expect(def?.placeable).toBeUndefined()
    }
    expect(resolveRailAreas(defs, null).bar).toEqual(['section:alpha', 'beta:workspace'])
    const unpinned = moveRailItem(defs, null, 'section:alpha', 'overflow', 0)
    expect(resolveRailAreas(defs, unpinned).bar).toEqual(['beta:workspace'])
    const pinned = moveRailItem(defs, unpinned, 'section:alpha', 'bar', 0)
    expect(resolveRailAreas(defs, pinned).bar).toEqual(['section:alpha', 'beta:workspace'])
  })

  it('still lets a non-plugin (core) entry default to the bar and stay placeable', () => {
    const { defs } = buildRailEntries({
      ...baseInput,
      railSections: [section('files', { defaultArea: 'bar' })],
    })
    const def = defs.find((d) => d.id === 'section:files')
    expect(def?.defaultArea).toBe('bar')
    expect(def?.placeable).toBeUndefined()
  })

  it('puts categorized core tools in the catalog without assigning plugin ownership', () => {
    const { defs, entryMap } = buildRailEntries({
      ...baseInput,
      customizableActions: [action('usage', { toolCategory: 'utilities', defaultArea: 'bottom' })],
    })
    expect(defs[0]?.defaultArea).toBe('bar')
    expect(defs[0]?.plugin).toBeUndefined()
    expect(entryMap.get('usage')?.toolCategory).toBe('utilities')
    const unpinned = moveRailItem(defs, null, 'usage', 'overflow', 0)
    expect(resolveRailAreas(defs, unpinned).bar).toEqual([])
    expect(resolveRailAreas(defs, unpinned).overflow).toEqual(['usage'])
  })

  it('marks a section active only when the sidebar is open AND it is the active one', () => {
    const open = buildRailEntries({
      ...baseInput,
      railSections: [section('files')],
      sidebarOpen: true,
      activeSection: 'files',
    })
    expect(open.entryMap.get('section:files')?.active).toBe(true)
    const closed = buildRailEntries({
      ...baseInput,
      railSections: [section('files')],
      sidebarOpen: false,
      activeSection: 'files',
    })
    expect(closed.entryMap.get('section:files')?.active).toBe(false)
  })

  it('routes a section click through onSectionClick with the raw id', () => {
    const clicks: string[] = []
    const { entryMap } = buildRailEntries({
      ...baseInput,
      railSections: [section('files')],
      onSectionClick: (id) => clicks.push(id),
    })
    entryMap.get('section:files')?.onClick()
    expect(clicks).toEqual(['files'])
  })

  it('passes an action onClick straight through', () => {
    let hit = false
    const { entryMap } = buildRailEntries({
      ...baseInput,
      customizableActions: [
        action('a', {
          onClick: () => {
            hit = true
          },
        }),
      ],
    })
    entryMap.get('a')?.onClick()
    expect(hit).toBe(true)
  })

  it('carries the plugin flag onto section + action entries', () => {
    const { entryMap } = buildRailEntries({
      ...baseInput,
      railSections: [section('docker', { plugin: true })],
      customizableActions: [action('a', { plugin: true })],
    })
    expect(entryMap.get('section:docker')?.plugin).toBe(true)
    expect(entryMap.get('a')?.plugin).toBe(true)
  })
})
