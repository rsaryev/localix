import { describe, expect, test } from 'bun:test'
import {
  groupViewModel,
  scopedViewRoot,
  adjacentGroupId,
  focusedFilePath,
  focusedVisibleTabId,
  openFilePaths,
  leafHasVisibleTab,
} from './groupView'
import { makeLeaf, insertSplit, leafIds } from './tree'
import type { WorkItem } from './workItem'
import type { ScopeActiveTab } from './warm'

const item = (id: string, scope?: string): WorkItem => ({
  kind: 'file',
  id,
  title: id,
  ...(scope ? { scope } : {}),
})
const items = (...xs: WorkItem[]): Record<string, WorkItem> =>
  Object.fromEntries(xs.map((x) => [x.id, x]))

describe('groupViewModel', () => {
  test('shows only the active scope + GLOBAL tabs, hides other sessions', () => {
    const leaf = makeLeaf('g1', ['a', 'b', 'g'], 'a')
    const reg = items(item('a', 'A'), item('b', 'B'), item('g', '@global'))
    const vm = groupViewModel(leaf, reg, 'A', ['A'], {})
    expect(vm.visibleTabs).toEqual(['a', 'g'])
    expect(vm.visibleActive).toBe('a')
  })

  test('legacy tabs without a scope are treated as global (never lost)', () => {
    const leaf = makeLeaf('g1', ['x'], 'x')
    const vm = groupViewModel(leaf, items(item('x')), 'A', ['A'], {})
    expect(vm.visibleTabs).toEqual(['x'])
  })

  test('on switch-away the stored activeTab is hidden; falls back to remembered tab', () => {
    // activeTab points at session B's tab (just switched to A). A remembers "a2".
    const leaf = makeLeaf('g1', ['a1', 'a2', 'b1'], 'b1')
    const reg = items(item('a1', 'A'), item('a2', 'A'), item('b1', 'B'))
    const scopeActive: ScopeActiveTab = { A: { g1: ['a2'] } }
    const vm = groupViewModel(leaf, reg, 'A', ['A', 'B'], scopeActive)
    expect(vm.visibleActive).toBe('a2') // remembered, not last-in-order ('a2' here happens last anyway)
  })

  test('keeps each warm session’s remembered tab mounted (hidden) for instant return', () => {
    const leaf = makeLeaf('g1', ['a1', 'b1', 'g'], 'a1')
    const reg = items(item('a1', 'A'), item('b1', 'B'), item('g', '@global'))
    const scopeActive: ScopeActiveTab = { A: { g1: ['a1'] }, B: { g1: ['b1'] } }
    const vm = groupViewModel(leaf, reg, 'A', ['A', 'B'], scopeActive)
    // visible active (a1) first, then warm background B's remembered b1.
    expect(vm.mountIds).toEqual(['a1', 'b1'])
  })

  test('keeps recently-active GLOBAL tabs mounted within every active session', () => {
    const leaf = makeLeaf('g1', ['chat', 'sample-view', 'pod'], 'pod')
    const reg = items(
      item('chat', 'A'),
      { kind: 'sample-view', id: 'sample-view', title: 'Sample View', scope: '@global' },
      { kind: 'kubernetes-pod', id: 'pod', title: 'api-1', scope: '@global' },
    )
    const scopeActive: ScopeActiveTab = {
      A: { g1: ['chat'] },
      '@global': { g1: ['pod', 'sample-view'] },
    }
    const vm = groupViewModel(leaf, reg, 'A', ['A'], scopeActive)
    expect(vm.visibleActive).toBe('pod')
    expect(vm.mountIds).toEqual(['pod', 'chat', 'sample-view'])
  })

  test('a re-homed GLOBAL tab cannot mount from stale history in its old group', () => {
    const leaf = makeLeaf('old', ['chat'], 'chat')
    const reg = items(item('chat', 'A'), {
      kind: 'sample-view',
      id: 'sample-view',
      title: 'Sample View',
      scope: '@global',
    })
    const scopeActive: ScopeActiveTab = {
      A: { old: ['chat'] },
      '@global': { old: ['sample-view'] },
    }
    const vm = groupViewModel(leaf, reg, 'A', ['A'], scopeActive)
    expect(vm.mountIds).toEqual(['chat'])
  })

  test('never re-mounts a GLOBAL/singleton tab as a warm background body', () => {
    const leaf = makeLeaf('g1', ['a1', 'term'], 'a1')
    const reg = items(item('a1', 'A'), {
      kind: 'terminal',
      id: 'term',
      title: 'T',
      scope: '@global',
    })
    // Even if B "remembered" the global terminal, it must not be mounted twice.
    const scopeActive: ScopeActiveTab = { A: { g1: ['a1'] }, B: { g1: ['term'] } }
    const vm = groupViewModel(leaf, reg, 'A', ['A', 'B'], scopeActive)
    expect(vm.mountIds).toEqual(['a1'])
  })

  test('out-of-warm-set sessions are not kept mounted', () => {
    const leaf = makeLeaf('g1', ['a1', 'c1'], 'a1')
    const reg = items(item('a1', 'A'), item('c1', 'C'))
    const scopeActive: ScopeActiveTab = { A: { g1: ['a1'] }, C: { g1: ['c1'] } }
    const vm = groupViewModel(leaf, reg, 'A', ['A'], scopeActive) // C not warm
    expect(vm.mountIds).toEqual(['a1'])
  })
})

describe('leafHasVisibleTab (shared visibility predicate)', () => {
  test('leafHasVisibleTab: own-scope and GLOBAL tabs count, other sessions do not', () => {
    const reg = items(item('a', 'A'), item('b', 'B'), item('g', '@global'))
    expect(leafHasVisibleTab(makeLeaf('g1', ['a']), reg, 'A')).toBe(true) // own session
    expect(leafHasVisibleTab(makeLeaf('g1', ['g']), reg, 'A')).toBe(true) // global
    expect(leafHasVisibleTab(makeLeaf('g1', ['b']), reg, 'A')).toBe(false) // other session
    expect(leafHasVisibleTab(makeLeaf('g1', []), reg, 'A')).toBe(false) // empty
  })
})

describe('scopedViewRoot (adaptive per-scope geometry)', () => {
  // Two groups: g1 = chat group (session B's chat), g2 = bottom group (session A's terminal).
  const root = insertSplit(
    makeLeaf('g1', ['chatB'], 'chatB', 'aux'),
    'g1',
    'down',
    makeLeaf('g2', ['termA'], 'termA'),
    [0.7, 0.3],
  )
  const reg = items(item('chatB', 'B'), item('termA', 'A'))
  const base = { root, items: reg, activeGroup: 'g1', scopeActiveTab: {} as ScopeActiveTab }

  test('collapses groups empty in the active session (no dead Empty group boxes)', () => {
    // Session A: only g2 (terminal) has content → g1 collapses out.
    expect(leafIds(scopedViewRoot({ ...base, activeScope: 'A', warmScopes: ['A'] }))).toEqual([
      'g2',
    ])
    // Session B: only g1 (chat) has content → g2 collapses out.
    expect(leafIds(scopedViewRoot({ ...base, activeScope: 'B', warmScopes: ['B'] }))).toEqual([
      'g1',
    ])
  })

  test('collapses a group whose only body is another session WARM tab (no blank group)', () => {
    // Active A; B is warm and chatB is g1's remembered tab — but g1 has NO tab
    // visible in A, so it still collapses (the warm body unmounts; no blank box).
    const warm = scopedViewRoot({
      ...base,
      activeScope: 'A',
      warmScopes: ['A', 'B'],
      scopeActiveTab: { B: { g1: ['chatB'] } },
    })
    expect(leafIds(warm)).toEqual(['g2'])
  })
})

describe('adjacentGroupId (focus next/previous editor group)', () => {
  // Three stacked groups, all holding a tab visible in session A.
  const root = insertSplit(
    insertSplit(
      makeLeaf('g1', ['a1'], 'a1', 'aux'),
      'g1',
      'down',
      makeLeaf('g2', ['a2'], 'a2'),
      [0.6, 0.4],
    ),
    'g2',
    'down',
    makeLeaf('g3', ['a3'], 'a3'),
    [0.5, 0.5],
  )
  const reg = items(item('a1', 'A'), item('a2', 'A'), item('a3', 'A'))
  const base = {
    root,
    items: reg,
    activeScope: 'A',
    warmScopes: ['A'] as string[],
    scopeActiveTab: {} as ScopeActiveTab,
  }

  test('cycles forward through visible groups, wrapping at the end', () => {
    expect(adjacentGroupId({ ...base, activeGroup: 'g1' }, 1)).toBe('g2')
    expect(adjacentGroupId({ ...base, activeGroup: 'g2' }, 1)).toBe('g3')
    expect(adjacentGroupId({ ...base, activeGroup: 'g3' }, 1)).toBe('g1') // wrap
  })

  test('cycles backward, wrapping at the start', () => {
    expect(adjacentGroupId({ ...base, activeGroup: 'g1' }, -1)).toBe('g3') // wrap
    expect(adjacentGroupId({ ...base, activeGroup: 'g2' }, -1)).toBe('g1')
  })

  test('returns null with fewer than two visible groups', () => {
    const single = { ...base, root: makeLeaf('g1', ['a1'], 'a1'), activeGroup: 'g1' }
    expect(adjacentGroupId(single, 1)).toBeNull()
    // Only g1 is visible in A → g2/g3 collapse out → nowhere to go.
    const onlyA1 = {
      ...base,
      items: items(item('a1', 'A'), item('a2', 'B'), item('a3', 'B')),
      activeGroup: 'g1',
    }
    expect(adjacentGroupId(onlyA1, 1)).toBeNull()
  })

  test('skips groups collapsed out of the active scope', () => {
    // g2 holds only session B's tab → collapses in A; forward from g1 lands on g3.
    const mixed = {
      ...base,
      items: items(item('a1', 'A'), item('a2', 'B'), item('a3', 'A')),
      activeGroup: 'g1',
    }
    expect(adjacentGroupId(mixed, 1)).toBe('g3')
  })

  test('moves to an edge when the focused group is not in the visible set', () => {
    // Active group g2 collapsed out (its tab is B's) → forward starts at the first.
    const mixed = {
      ...base,
      items: items(item('a1', 'A'), item('a2', 'B'), item('a3', 'A')),
      activeGroup: 'g2',
    }
    expect(adjacentGroupId(mixed, 1)).toBe('g1')
    expect(adjacentGroupId(mixed, -1)).toBe('g3')
  })
})

describe('focusedFilePath', () => {
  const fileAt = (id: string, scope: string, path: string): WorkItem => ({
    kind: 'file',
    id,
    title: path,
    scope,
    payload: { path },
  })
  const state = (over: Partial<Parameters<typeof focusedFilePath>[0]> = {}) => ({
    root: makeLeaf('g1', ['fA', 'fB'], 'fA'),
    activeGroup: 'g1',
    items: { fA: fileAt('fA', 'A', 'a.ts'), fB: fileAt('fB', 'B', 'b.ts') } as Record<
      string,
      WorkItem
    >,
    activeScope: 'A',
    warmScopes: ['A'] as string[],
    scopeActiveTab: {} as ScopeActiveTab,
    ...over,
  })

  test('returns the focused group’s visible file path', () => {
    expect(focusedFilePath(state())).toBe('a.ts')
  })

  test('never reports a background session’s file after a switch', () => {
    // activeTab still points at A's file, but B is now active → must NOT leak a.ts.
    expect(focusedFilePath(state({ activeScope: 'B' }))).toBe('b.ts')
  })

  test('null when the focused group has no visible file', () => {
    expect(focusedFilePath(state({ activeScope: 'Z', warmScopes: ['Z'] }))).toBeNull()
  })

  test('a focused DIFF tab also reports its path (path-backed, not just file)', () => {
    const diff: WorkItem = {
      kind: 'diff',
      id: 'dA',
      title: 'a.ts',
      scope: 'A',
      payload: { path: 'src/a.ts' },
    }
    expect(
      focusedFilePath(
        state({
          root: makeLeaf('g1', ['dA'], 'dA'),
          items: { dA: diff },
        }),
      ),
    ).toBe('src/a.ts')
  })

  test('focusedVisibleTabId returns the scope-visible active id, not the raw activeTab', () => {
    expect(focusedVisibleTabId(state())).toBe('fA')
    // Raw activeTab is still fA (session A), but B is active → resolves to fB.
    expect(focusedVisibleTabId(state({ activeScope: 'B' }))).toBe('fB')
    expect(focusedVisibleTabId(state({ activeScope: 'Z', warmScopes: ['Z'] }))).toBeNull()
  })
})

describe('openFilePaths (open editor tabs → completion context)', () => {
  const fileAt = (id: string, scope: string, path: string): WorkItem => ({
    kind: 'file',
    id,
    title: path,
    scope,
    payload: { path },
  })

  test('returns open file-tab paths for the scope, in tab order across groups', () => {
    const root = insertSplit(
      makeLeaf('g1', ['fa', 'fb'], 'fa'),
      'g1',
      'down',
      makeLeaf('g2', ['fc'], 'fc'),
      [0.5, 0.5],
    )
    const reg = items(
      fileAt('fa', 'A', 'a.ts'),
      fileAt('fb', 'A', 'b.ts'),
      fileAt('fc', 'A', 'c.ts'),
    )
    expect(openFilePaths({ root, items: reg }, 'A')).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  test('excludes a background session’s open files (scope filter)', () => {
    const leaf = makeLeaf('g1', ['fa', 'fb'], 'fa')
    const reg = items(fileAt('fa', 'A', 'a.ts'), fileAt('fb', 'B', 'b.ts'))
    expect(openFilePaths({ root: leaf, items: reg }, 'A')).toEqual(['a.ts'])
  })

  test('ignores non-file tabs (chat / terminal / diff)', () => {
    const leaf = makeLeaf('g1', ['fa', 'chat', 'term', 'diff'], 'fa')
    const reg = items(
      fileAt('fa', 'A', 'a.ts'),
      { kind: 'chat', id: 'chat', title: 'Chat', scope: 'A' },
      { kind: 'terminal', id: 'term', title: 'T', scope: 'A' },
      { kind: 'diff', id: 'diff', title: 'd', scope: 'A', payload: { path: 'd.ts' } },
    )
    expect(openFilePaths({ root: leaf, items: reg }, 'A')).toEqual(['a.ts'])
  })

  test('skips a file tab without a resolved payload.path', () => {
    const leaf = makeLeaf('g1', ['fa', 'nop'], 'fa')
    const reg = items(fileAt('fa', 'A', 'a.ts'), {
      kind: 'file',
      id: 'nop',
      title: 'n',
      scope: 'A',
    })
    expect(openFilePaths({ root: leaf, items: reg }, 'A')).toEqual(['a.ts'])
  })

  test('dedups the same path opened in two split groups', () => {
    const root = insertSplit(
      makeLeaf('g1', ['fa'], 'fa'),
      'g1',
      'down',
      makeLeaf('g2', ['fa2'], 'fa2'),
      [0.5, 0.5],
    )
    const reg = items(fileAt('fa', 'A', 'a.ts'), fileAt('fa2', 'A', 'a.ts'))
    expect(openFilePaths({ root, items: reg }, 'A')).toEqual(['a.ts'])
  })

  test('legacy scope-less file tab stays visible (treated as global)', () => {
    const leaf = makeLeaf('g1', ['fa'], 'fa')
    const reg = {
      fa: { kind: 'file', id: 'fa', title: 'a.ts', payload: { path: 'a.ts' } } as WorkItem,
    }
    expect(openFilePaths({ root: leaf, items: reg }, 'A')).toEqual(['a.ts'])
  })
})
