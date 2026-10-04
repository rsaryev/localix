import { describe, expect, it } from 'bun:test'
import { buildRailEntries, type BuildRailEntriesInput } from './buildRailEntries'
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

  it('marks a PLUGIN entry non-placeable, ignoring its declared defaultArea "bar"', () => {
    // Two contributed entries both request `defaultArea: 'bar'`. Plugin views have
    // no rail placement any more, so the request is not honored and the entry is
    // flagged so a stale saved layout cannot resurrect a placement either.
    const { defs } = buildRailEntries({
      ...baseInput,
      railSections: [section('alpha', { plugin: true, defaultArea: 'bar' })],
      customizableActions: [action('beta:workspace', { plugin: true, defaultArea: 'bar' })],
    })
    for (const id of ['section:alpha', 'beta:workspace']) {
      const def = defs.find((d) => d.id === id)
      expect(def?.defaultArea).toBe('overflow')
      expect(def?.placeable).toBe(false)
    }
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
