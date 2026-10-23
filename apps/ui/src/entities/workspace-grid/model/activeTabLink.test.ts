import { describe, expect, test } from 'bun:test'
import {
  activeTabLink,
  activeTabLinks,
  AUTO_LINK_LIMIT,
  candidateScore,
  tabLinkToken,
  type TabCandidate,
} from './activeTabLink'
import { clearLiveTabMessageContext, publishLiveTabMessageContext } from './liveTabMessageContext'
import { insertSplit, makeLeaf } from './tree'
import type { WorkItem } from '@/shared/lib/workItem'
import type { ScopeActiveTab } from './warm'
import { resourceMessageBindingDraft } from '@localixai/mini-app-sdk/ui'

const file = (id: string, path: string, scope = 'A'): WorkItem => ({
  kind: 'file',
  id,
  title: path.split('/').pop() ?? path,
  scope,
  payload: { path },
})
const chat = (id: string): WorkItem => ({ kind: 'chat', id, title: 'Chat', scope: '@global' })
const terminal = (id: string, terminalId: string, scope = 'A'): WorkItem => ({
  kind: 'terminal',
  id,
  title: 'zsh',
  scope,
  payload: { terminalId },
})
const settings = (id: string): WorkItem => ({
  kind: 'settings',
  id,
  title: 'Settings',
  scope: '@global',
})

const baseState = (over: Partial<Parameters<typeof activeTabLink>[0]> = {}) => ({
  root: makeLeaf('g1', ['f1'], 'f1'),
  activeGroup: 'g1',
  items: { f1: file('f1', 'src/a.ts') } as Record<string, WorkItem>,
  activeScope: 'A',
  warmScopes: ['A'] as string[],
  scopeActiveTab: {} as ScopeActiveTab,
  ...over,
})

describe('tabLinkToken', () => {
  test('a file tab mints a CONTENT @file: token (not the link-only @path mention)', () => {
    expect(tabLinkToken(file('f1', 'src/a.ts'))).toEqual({ token: '@file:src/a.ts', label: 'a.ts' })
  })

  test('a terminal tab mints its @terminal: token with the shortened id', () => {
    expect(tabLinkToken(terminal('t1', 'abcdef1234567890'))?.token).toBe('@terminal:abcdef12')
  })

  test('non-linkable kinds (chat, settings, undefined) contribute nothing', () => {
    expect(tabLinkToken(chat('c1'))).toBeNull()
    expect(tabLinkToken(settings('s1'))).toBeNull()
    expect(tabLinkToken(undefined)).toBeNull()
  })
})

describe('activeTabLink', () => {
  test('links the focused group’s visible tab', () => {
    expect(activeTabLink(baseState())).toMatchObject({
      tabId: 'f1',
      token: '@file:src/a.ts',
      label: 'a.ts',
      binding: {
        source: 'active-tab',
        target: { kind: 'file', token: '@file:src/a.ts', label: 'a.ts' },
      },
    })
  })

  test('falls back past a non-linkable focused tab (chat) to another visible group', () => {
    const root = insertSplit(
      makeLeaf('g1', ['c1'], 'c1'),
      'g1',
      'right',
      makeLeaf('g2', ['f2'], 'f2'),
    )
    const state = baseState({
      root,
      activeGroup: 'g1',
      items: { c1: chat('c1'), f2: file('f2', 'src/b.ts') },
    })
    expect(activeTabLink(state)).toMatchObject({
      tabId: 'f2',
      token: '@file:src/b.ts',
      label: 'b.ts',
    })
  })

  test('prefers the focused group over other groups', () => {
    const root = insertSplit(
      makeLeaf('g1', ['f1'], 'f1'),
      'g1',
      'right',
      makeLeaf('g2', ['f2'], 'f2'),
    )
    const state = baseState({
      root,
      activeGroup: 'g2',
      items: { f1: file('f1', 'src/a.ts'), f2: file('f2', 'src/b.ts') },
    })
    expect(activeTabLink(state)?.tabId).toBe('f2')
  })

  test('null when nothing visible is linkable', () => {
    const state = baseState({ items: { f1: settings('f1') } })
    expect(activeTabLink(state)).toBeNull()
  })

  test('another session’s tab never leaks: scope filter applies', () => {
    const state = baseState({ items: { f1: file('f1', 'src/a.ts', 'B') } })
    expect(activeTabLink(state)).toBeNull()
  })
})

/**
 * N-tab auto-link. One slot was the whole reason a tab you had just opened could stay invisible: the
 * selector returns the FIRST linkable candidate, so whichever group happened to be focused won.
 */
describe('activeTabLinks', () => {
  const twoGroups = (items: Record<string, WorkItem>, active = 'g1') => {
    const root = insertSplit(makeLeaf('g1', ['a'], 'a'), 'g1', 'right', makeLeaf('g2', ['b'], 'b'))
    return baseState({ root, activeGroup: active, items })
  }

  test('collects the focused group FIRST, then the other visible groups', () => {
    const links = activeTabLinks(
      twoGroups({ a: file('a', 'src/a.ts'), b: file('b', 'src/b.ts') }, 'g2'),
    )
    expect(links.map((l) => l.tabId)).toEqual(['b', 'a'])
  })

  test('every visible file link carries content instead of a decorative @path mention', () => {
    const links = activeTabLinks(
      twoGroups({ a: file('a', 'src/a.ts'), b: file('b', 'src/b.ts') }, 'g1'),
    )
    expect(links[0]?.token).toBe('@file:src/a.ts')
    expect(links[1]?.token).toBe('@file:src/b.ts')
  })

  test('skips non-linkable tabs instead of spending a slot on them', () => {
    const links = activeTabLinks(twoGroups({ a: chat('a'), b: file('b', 'src/b.ts') }, 'g1'))
    expect(links.map((l) => l.tabId)).toEqual(['b'])
    // …and the surviving link is the primary, so it keeps content.
    expect(links[0]?.token).toBe('@file:src/b.ts')
  })

  test('honours an explicit limit', () => {
    // The dedupe guard next to this is deliberately NOT asserted: one tab cannot be the visible
    // active tab of two groups, so no fixture can reach it (see the comment at the guard).
    const links = activeTabLinks(
      twoGroups({ a: file('a', 'src/a.ts'), b: file('b', 'src/b.ts') }, 'g1'),
      1,
    )
    expect(links).toHaveLength(1)
    expect(links[0]?.tabId).toBe('a')
  })

  test('the default limit is 5 — a split with a couple of panels plus what you were just in', () => {
    // Affordable at five because ambient refs are the first thing the
    // 20-per-message wire and context budgets shed.
    expect(AUTO_LINK_LIMIT).toBe(5)
  })

  test('one group links its open file and two contributed working sets', () => {
    const db = {
      kind: 'plugin-view',
      id: 'db',
      title: 'Local database',
      scope: '@global',
    } satisfies WorkItem
    const trade = {
      kind: 'plugin-view',
      id: 'trade',
      title: 'BTC/USDT',
      scope: '@global',
    } satisfies WorkItem
    publishLiveTabMessageContext('db', {
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri: 'localix://resource/fixture-db/local',
          label: db.title,
        }),
      ],
    })
    publishLiveTabMessageContext('trade', {
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri: 'localix://resource/fixture-market/binance/markets/BTC%2FUSDT/candles/1h',
          label: trade.title,
        }),
      ],
    })

    try {
      const state = baseState({
        root: makeLeaf('g1', ['file', 'db', 'trade'], 'file'),
        items: {
          file: file('file', 'src/strategy.ts'),
          db,
          trade,
        } as Record<string, WorkItem>,
      })
      expect(activeTabLinks(state).map((link) => link.token)).toEqual([
        '@file:src/strategy.ts',
        '@resource:localix://resource/fixture-db/local',
        '@snippet:Local database — plugin context',
        '@resource:localix://resource/fixture-market/binance/markets/BTC%2FUSDT/candles/1h',
        '@snippet:BTC/USDT — plugin context',
      ])
    } finally {
      clearLiveTabMessageContext()
    }
  })

  test('activeTabLink stays the single-link façade, byte-identical to before', () => {
    const state = twoGroups({ a: file('a', 'src/a.ts'), b: file('b', 'src/b.ts') }, 'g1')
    expect(activeTabLink(state)).toMatchObject({
      tabId: 'a',
      token: '@file:src/a.ts',
      label: 'a.ts',
    })
  })

  test('nothing linkable yields an empty array, not a phantom entry', () => {
    expect(activeTabLinks(twoGroups({ a: chat('a'), b: settings('b') }))).toEqual([])
  })

  test('a third-party plugin view is ambient context even before its first snapshot', () => {
    const pluginView = {
      kind: 'plugin-view',
      id: 'plugin-view:fixture.dashboard',
      title: 'Fixture dashboard',
      scope: '@global',
      payload: { pluginName: 'fixture', viewId: 'dashboard' },
    } satisfies WorkItem
    const state = baseState({
      root: makeLeaf('g1', [pluginView.id], pluginView.id),
      activeGroup: 'g1',
      activeScope: '@global',
      warmScopes: ['@global'],
      items: { [pluginView.id]: pluginView },
    })
    const link = activeTabLink(state)
    expect(link?.tabId).toBe(pluginView.id)
    expect(link?.binding.target.kind).toBe('snippet')
    expect(link?.binding.target.attributes?.content).toContain('none published yet')
    expect(link?.binding.target.attributes?.content).toContain('Plugin: fixture')
  })
})

/**
 * FRESHNESS. The recency signal is the grid's own per-(scope, group) tab MRU — `scopeActiveTab`,
 * "most-recent FIRST", already maintained for the warm-body lifecycle. Nothing new is tracked, and
 * because it is an ORDER rather than timestamps it replays identically (a wall-clock read would not).
 *
 * The stored MRU order is the correct primitive: unlike timestamps it replays deterministically,
 * with the active editor always first.
 */
describe('activeTabLinks — tab freshness', () => {
  const threeInOneGroup = (mru: string[]) =>
    baseState({
      root: makeLeaf('g1', ['a', 'b', 'c'], 'a'),
      activeGroup: 'g1',
      items: {
        a: file('a', 'src/a.ts'),
        b: file('b', 'src/b.ts'),
        c: file('c', 'src/c.ts'),
      } as Record<string, WorkItem>,
      scopeActiveTab: { A: { g1: mru } } as unknown as ScopeActiveTab,
    })

  test('open MRU tabs materialize after the visible tab', () => {
    const links = activeTabLinks(threeInOneGroup(['a', 'b', 'c']))
    expect(links.map((l) => l.tabId)).toEqual(['a', 'b', 'c'])
  })

  test('a different open-tab MRU order changes only the lower-ranked links', () => {
    const links = activeTabLinks(threeInOneGroup(['c', 'b', 'a']))
    expect(links.map((l) => l.tabId)).toEqual(['a', 'c', 'b'])
  })

  test('the visible tab carries file content', () => {
    const links = activeTabLinks(threeInOneGroup(['a', 'b', 'c']))
    expect(links[0]?.token).toBe('@file:src/a.ts')
  })

  test('the limit admits the freshest open tab after the visible set', () => {
    expect(activeTabLinks(threeInOneGroup(['a', 'b', 'c']), 2).map((l) => l.tabId)).toEqual([
      'a',
      'b',
    ])
  })

  test('a tab with no live item never links, even when the MRU still names it', () => {
    // `dropTabFromScopeActive` prunes closed tabs, but a stale entry must not resolve to a phantom.
    const state = baseState({
      root: makeLeaf('g1', ['a', 'b'], 'a'),
      activeGroup: 'g1',
      items: { a: file('a', 'src/a.ts') } as Record<string, WorkItem>,
      scopeActiveTab: { A: { g1: ['a', 'gone'] } } as unknown as ScopeActiveTab,
    })
    expect(activeTabLinks(state).map((l) => l.tabId)).toEqual(['a'])
  })
})

/**
 * RANKING. The previous selector walked group by group: the focused group's whole MRU first, then the
 * others. With one slot that was invisible; with five it means one group's warm HISTORY can fill every
 * slot while a panel visibly open beside it is never considered. So candidates are now scored and
 * sorted before the cap.
 *
 * The precedence being pinned — what you can SEE beats what you merely visited, and only then does the
 * caret's group matter:
 *
 *   on screen + focused  >  on screen elsewhere  >  warm in focused  >  warm elsewhere
 *
 * These tests assert the ORDER, never the weights, so the numbers stay tunable.
 *
 * Visibility stays above focus and recency. Recency is capped below both so it can only break ties
 * inside a bucket.
 */
describe('candidate ranking', () => {
  /** Two groups, `g1` on the left. Each group's MRU is given explicitly. */
  const split = (
    items: Record<string, WorkItem>,
    tabs: { g1: string[]; g2: string[] },
    mru: { g1?: string[]; g2?: string[] },
    activeGroup = 'g1',
  ) =>
    baseState({
      root: insertSplit(
        makeLeaf('g1', tabs.g1, tabs.g1[0]),
        'g1',
        'right',
        makeLeaf('g2', tabs.g2, tabs.g2[0]),
      ),
      activeGroup,
      items,
      scopeActiveTab: {
        A: { ...(mru.g1 ? { g1: mru.g1 } : {}), ...(mru.g2 ? { g2: mru.g2 } : {}) },
      },
    })

  const ranked = (state: Parameters<typeof activeTabLinks>[0]) =>
    activeTabLinks(state).map((l) => l.tabId)

  test('a VISIBLE tab in another group outranks warm history', () => {
    // The reported scenario: a pod list open in the pane beside the editor. Walking group-first put
    // `a2`/`a3` — tabs you cannot even see — ahead of it.
    const items = {
      a1: file('a1', 'src/a1.ts'),
      a2: file('a2', 'src/a2.ts'),
      a3: file('a3', 'src/a3.ts'),
      b1: file('b1', 'src/b1.ts'),
    }
    const state = split(
      items,
      { g1: ['a1', 'a2', 'a3'], g2: ['b1'] },
      { g1: ['a1', 'a2', 'a3'], g2: ['b1'] },
    )
    expect(ranked(state)).toEqual(['a1', 'b1', 'a2', 'a3'])
  })

  test('within the on-screen tabs, the focused group comes first', () => {
    const items = { a1: file('a1', 'src/a1.ts'), b1: file('b1', 'src/b1.ts') }
    const tabs = { g1: ['a1'], g2: ['b1'] }
    const mru = { g1: ['a1'], g2: ['b1'] }
    expect(ranked(split(items, tabs, mru, 'g1'))).toEqual(['a1', 'b1'])
    expect(ranked(split(items, tabs, mru, 'g2'))).toEqual(['b1', 'a1'])
  })

  test('warm tabs in every group follow the complete visible set', () => {
    const items = {
      a1: file('a1', 'src/a1.ts'),
      a2: file('a2', 'src/a2.ts'),
      a3: file('a3', 'src/a3.ts'),
      b1: file('b1', 'src/b1.ts'),
      b2: file('b2', 'src/b2.ts'),
    }
    const state = split(
      items,
      { g1: ['a1', 'a2', 'a3'], g2: ['b1', 'b2'] },
      { g1: ['a1', 'a2', 'a3'], g2: ['b1', 'b2'] },
    )
    expect(ranked(state)).toEqual(['a1', 'b1', 'a2', 'a3', 'b2'])
  })

  test('warm MRU order ranks the open context after the visible tab', () => {
    const items = {
      a1: file('a1', 'src/a1.ts'),
      a2: file('a2', 'src/a2.ts'),
      a3: file('a3', 'src/a3.ts'),
    }
    // Strip order a1,a2,a3 — but a3 was visited more recently than a2.
    const state = split(items, { g1: ['a1', 'a2', 'a3'], g2: [] }, { g1: ['a1', 'a3', 'a2'] })
    expect(ranked(state)).toEqual(['a1', 'a3', 'a2'])
  })

  test('visible panels are never starved by warm history', () => {
    const items = Object.fromEntries(
      ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) => [id, file(id, `src/${id}.ts`)]),
    ) as Record<string, WorkItem>
    items.b1 = file('b1', 'src/b1.ts')
    const state = split(
      items,
      { g1: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], g2: ['b1'] },
      { g1: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], g2: ['b1'] },
    )
    const out = ranked(state)
    expect(out).toEqual(['a1', 'b1', 'a2', 'a3', 'a4'])
  })

  test('all visible links carry resolvable file content, whichever group is focused', () => {
    const items = { a1: file('a1', 'src/a1.ts'), b1: file('b1', 'src/b1.ts') }
    const links = activeTabLinks(
      split(items, { g1: ['a1'], g2: ['b1'] }, { g1: ['a1'], g2: ['b1'] }, 'g2'),
    )
    expect(links[0]).toMatchObject({ tabId: 'b1', token: '@file:src/b1.ts' })
    expect(links[1]).toMatchObject({ tabId: 'a1', token: '@file:src/a1.ts' })
  })

  test('a non-linkable top candidate does not spend the content slot', () => {
    // The chat tab is on screen and focused — the highest-scoring candidate — but mints no token, so
    // the content slot must fall through to the next ranked tab rather than be lost.
    const items = { c1: chat('c1'), b1: file('b1', 'src/b1.ts') }
    const links = activeTabLinks(
      split(items, { g1: ['c1'], g2: ['b1'] }, { g1: ['c1'], g2: ['b1'] }, 'g1'),
    )
    expect(links).toHaveLength(1)
    expect(links[0]?.token).toBe('@file:src/b1.ts')
  })
})

describe('candidateScore is explainable', () => {
  const c = (over: Partial<TabCandidate> = {}): TabCandidate => ({
    tabId: 't',
    onScreen: false,
    focusedGroup: false,
    warmRank: 1,
    ...over,
  })

  test('the four buckets are strictly ordered', () => {
    const onScreenFocused = candidateScore(c({ onScreen: true, focusedGroup: true, warmRank: 0 }))
    const onScreenElsewhere = candidateScore(c({ onScreen: true, warmRank: 0 }))
    const warmFocused = candidateScore(c({ focusedGroup: true, warmRank: 1 }))
    const warmElsewhere = candidateScore(c({ warmRank: 1 }))
    expect(onScreenFocused).toBeGreaterThan(onScreenElsewhere)
    expect(onScreenElsewhere).toBeGreaterThan(warmFocused)
    expect(warmFocused).toBeGreaterThan(warmElsewhere)
  })

  test('recency can never cross a bucket boundary — it only breaks ties inside one', () => {
    // The freshest possible warm tab still loses to the stalest on-screen one, at any depth.
    const freshestWarmFocused = candidateScore(c({ focusedGroup: true, warmRank: 1 }))
    const stalestOnScreen = candidateScore(c({ onScreen: true, warmRank: 99 }))
    expect(stalestOnScreen).toBeGreaterThan(freshestWarmFocused)
  })

  test('deeper warm history scores lower, monotonically', () => {
    const scores = [1, 2, 3, 4, 5].map((warmRank) => candidateScore(c({ warmRank })))
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(new Set(scores).size).toBe(scores.length)
  })
})
