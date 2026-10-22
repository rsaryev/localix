import { describe, it, expect } from 'bun:test'
import { buildExtCatalog, type ExtCatalogItem, type ExtStateRecord } from './catalog'
import type { AvailabilityReader } from '../capabilities/availability'
import { trustFallback } from './trust'

// ── helpers ──────────────────────────────────────────────────────────────────

interface Item extends ExtCatalogItem {
  manifest: { name: string }
  projectId: string
}

interface State extends ExtStateRecord {
  name: string
  projectId: string
}

function makeItem(name: string, projectId = ''): Item {
  return { manifest: { name }, projectId }
}

function makeState(name: string, projectId = ''): State {
  return { name, projectId }
}

/**
 * A rule store naming exactly which items a rule mentions, and how.
 *
 * The state row does not carry the answer: the agent's RULES do, and an item no rule
 * mentions falls through to what its trust class means.
 */
const rules = (decided: Record<string, boolean>): AvailabilityReader => ({
  effectFor: (_kind, name, trust = 'bundled') =>
    name in decided ? (decided[name] ? 'allow' : 'deny') : trustFallback(trust),
})

/** This fixture's items ship with the app unless a case says otherwise. */
const trustOf = () => 'bundled' as const

/** Build the stateByKey map the same way the leaf catalogs do. */
function stateMap(rows: State[]): Map<string, State> {
  return new Map(rows.map((s) => [`${s.projectId}:${s.name}`, s]))
}

// ── tests ─────────────────────────────────────────────────────────────────────

/** Every case below builds the catalog the same way; only the rules differ. */
const build = (items: Item[], decided: Record<string, boolean> = {}, states: State[] = []) =>
  buildExtCatalog({
    discovered: items,
    stateByKey: stateMap(states),
    kind: 'plugin',
    availability: rules(decided),
    trustOf,
  })

describe('buildExtCatalog', () => {
  it('an item no rule mentions falls through to what its trust class means', () => {
    const catalog = build([makeItem('alpha'), makeItem('beta')])
    expect(catalog.all).toHaveLength(2)
    expect(catalog.all.every((e) => e.enabled)).toBe(true)
  })

  it('a rule decides in either direction, and only for the item it names', () => {
    const catalog = build([makeItem('alpha'), makeItem('beta')], { alpha: false })
    const alpha = catalog.all.find((e) => e.item.manifest.name === 'alpha')!
    const beta = catalog.all.find((e) => e.item.manifest.name === 'beta')!
    expect(alpha.enabled).toBe(false)
    expect(beta.enabled).toBe(true)
  })

  it('a rule beats what the trust class alone would have said', () => {
    // Bundled means "runs unless told otherwise", so only a rule can produce a `false` here.
    // The class decides silence; a rule decides everything else.
    const catalog = buildExtCatalog({
      discovered: [makeItem('alpha')],
      stateByKey: new Map<string, State>(),
      kind: 'plugin',
      availability: rules({ alpha: false }),
      trustOf: () => 'bundled',
    })
    expect(catalog.all[0]!.enabled).toBe(false)
  })

  it('an untrusted item nobody ruled on waits to be asked about', () => {
    // The distinction `awaitingConsent` exists for: not running, but not refused either —
    // which is what lets a caller with a person to ask raise the question.
    const catalog = buildExtCatalog({
      discovered: [makeItem('alpha')],
      stateByKey: new Map<string, State>(),
      kind: 'plugin',
      availability: rules({}),
      trustOf: () => 'untrusted',
    })
    expect(catalog.all[0]!.enabled).toBe(false)
    expect(catalog.all[0]!.awaitingConsent).toBe(true)
  })

  it('a rule about the trust class itself settles every item in it', () => {
    // `plugin:* untrusted allow` is the row a person writes to stop being asked about
    // dropped-in plugins — an ordinary rule, matching on the class as its resource.
    const catalog = buildExtCatalog({
      discovered: [makeItem('alpha')],
      stateByKey: new Map<string, State>(),
      kind: 'plugin',
      availability: {
        effectFor: (_kind, _name, trust) => (trust === 'untrusted' ? 'allow' : 'deny'),
      },
      trustOf: () => 'untrusted',
    })
    expect(catalog.all[0]!.enabled).toBe(true)
  })

  it('a state row carries config and provenance, never availability', () => {
    // The row exists and says nothing about whether the item runs; the rule does.
    const catalog = build([makeItem('alpha')], { alpha: false }, [makeState('alpha')])
    expect(catalog.all[0]!.state).toBeDefined()
    expect(catalog.all[0]!.enabled).toBe(false)
  })

  it('.enabled filters to only enabled entries', () => {
    const items = [makeItem('alpha'), makeItem('beta'), makeItem('gamma')]
    const catalog = build(items, { alpha: false, beta: true })
    expect(catalog.enabled.map((e) => e.item.manifest.name)).toEqual(['beta', 'gamma'])
  })

  it('.find resolves by name in global scope (projectId="")', () => {
    const catalog = build([makeItem('alpha', ''), makeItem('beta', '')])
    expect(catalog.find('alpha', '')?.item.manifest.name).toBe('alpha')
  })

  it('.find returns undefined for an unknown name', () => {
    expect(build([makeItem('alpha')]).find('nope', '')).toBeUndefined()
  })

  it('.find is scope-aware: project entry and global entry are distinct', () => {
    // Same name, different projectId — two separate catalog entries.
    const catalog = build([makeItem('shared', ''), makeItem('shared', 'proj-1')])
    expect(catalog.all).toHaveLength(2)
    expect(catalog.find('shared', '')?.item.projectId).toBe('')
    expect(catalog.find('shared', 'proj-1')?.item.projectId).toBe('proj-1')
  })

  it('a user-scope item read from a project uses the user row; a project item does not', () => {
    // Claude Code keeps one `pluginConfigs` value per user. A home plugin is projected into the
    // project (its projectId is the project's), and used to miss the row saved without one.
    const user: Item = { ...makeItem('home', 'proj-1'), scope: 'global' }
    const own: Item = { ...makeItem('local', 'proj-1'), scope: 'project' }
    const catalog = build([user, own], {}, [makeState('home'), makeState('local')])
    expect(catalog.find('home', 'proj-1')?.state).toEqual(makeState('home'))
    expect(catalog.find('local', 'proj-1')?.state).toBeUndefined()
    // A row written for the project itself still answers first.
    const both = build([user], {}, [makeState('home'), makeState('home', 'proj-1')])
    expect(both.find('home', 'proj-1')?.state).toEqual(makeState('home', 'proj-1'))
  })

  it('preserves discovery order in .all', () => {
    const catalog = build(['c', 'a', 'b'].map((n) => makeItem(n)))
    expect(catalog.all.map((e) => e.item.manifest.name)).toEqual(['c', 'a', 'b'])
  })

  it('returns empty collections when discovered list is empty', () => {
    const catalog = build([])
    expect(catalog.all).toHaveLength(0)
    expect(catalog.enabled).toHaveLength(0)
    expect(catalog.find('x', '')).toBeUndefined()
  })
})
