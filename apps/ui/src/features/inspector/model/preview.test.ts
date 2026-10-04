import { describe, expect, test } from 'bun:test'

import {
  recordPreview,
  activatePreview,
  closeTab,
  closeTabsForSession,
  discardSessionPreviews,
  type PreviewMaps,
  type PreviewEntry,
} from './preview'
import { originOf } from '../../../shared/lib/url'

const empty: PreviewMaps = { previewBySession: {}, previewTabsBySession: {} }
const entry = (id: string, over: Partial<PreviewEntry> = {}): PreviewEntry => ({
  previewId: id,
  url: `http://${id}/`,
  version: 1,
  ...over,
})

describe('preview state transforms', () => {
  test('originOf returns the URL origin', () => {
    expect(originOf('http://localhost:5173/some/path?q=1')).toBe('http://localhost:5173')
    expect(originOf('not a url')).toBe('not a url')
  })

  test('recordPreview opens, activates, and dedups by origin', () => {
    const a = recordPreview(empty, 'S', entry('a'))
    expect(a.previewTabsBySession.S.map((e) => e.previewId)).toEqual(['a'])
    expect(a.previewBySession.S.previewId).toBe('a')

    const b = recordPreview(a, 'S', entry('b'))
    expect(b.previewTabsBySession.S.map((e) => e.previewId)).toEqual(['a', 'b'])
    expect(b.previewBySession.S.previewId).toBe('b')

    // Re-opening 'a' updates in place (no duplicate) and becomes active.
    const a2 = recordPreview(b, 'S', entry('a', { version: 2 }))
    expect(a2.previewTabsBySession.S.map((e) => e.previewId)).toEqual(['a', 'b'])
    expect(a2.previewTabsBySession.S[0].version).toBe(2)
    expect(a2.previewBySession.S.previewId).toBe('a')
  })

  test('refreshing the same server retains its launch command', () => {
    const opened = recordPreview(empty, 'S', entry('a', { startCommand: 'bun run dev' }))
    const refreshed = recordPreview(opened, 'S', entry('a', { version: 2 }))
    expect(refreshed.previewBySession.S.startCommand).toBe('bun run dev')
    expect(refreshed.previewTabsBySession.S[0]?.startCommand).toBe('bun run dev')
  })

  test('closeTab falls back to a neighbour, then clears active on the last close', () => {
    let m = recordPreview(
      recordPreview(recordPreview(empty, 'S', entry('a')), 'S', entry('b')),
      'S',
      entry('c'),
    )
    m = { ...m, previewBySession: activatePreview(m, 'S', 'b')! } // make 'b' active
    // close active 'b' → neighbour 'c' (the element shifted into b's index)
    const afterB = closeTab(m, 'S', 'b')!
    expect(afterB.previewTabsBySession.S.map((e) => e.previewId)).toEqual(['a', 'c'])
    expect(afterB.previewBySession.S.previewId).toBe('c')

    const m2 = { ...m, ...afterB }
    const afterC = closeTab(m2, 'S', 'c')!
    expect(afterC.previewBySession.S.previewId).toBe('a')
    const m3 = { ...m2, ...afterC }
    const afterA = closeTab(m3, 'S', 'a')!
    expect(afterA.previewTabsBySession.S).toHaveLength(0)
    expect(afterA.previewBySession.S).toBeUndefined()
  })

  test('closing a non-active tab leaves the active tab unchanged', () => {
    let m = recordPreview(
      recordPreview(recordPreview(empty, 'S', entry('a')), 'S', entry('b')),
      'S',
      entry('c'),
    )
    m = { ...m, previewBySession: activatePreview(m, 'S', 'c')! } // 'c' active
    const after = closeTab(m, 'S', 'a')! // close a non-active tab
    expect(after.previewTabsBySession.S.map((e) => e.previewId)).toEqual(['b', 'c'])
    expect(after.previewBySession.S.previewId).toBe('c') // active untouched
  })

  test('closeTabsForSession(previewId) closes just that tab (delegates to closeTab)', () => {
    const m = recordPreview(recordPreview(empty, 'S', entry('a')), 'S', entry('b'))
    const after = closeTabsForSession(m, 'S', 'a')!
    expect(after.previewTabsBySession.S.map((e) => e.previewId)).toEqual(['b'])
  })

  test("closeTabsForSession() closes ALL the session's preview tabs + clears active", () => {
    const m = recordPreview(recordPreview(empty, 'S', entry('a')), 'S', entry('b'))
    const after = closeTabsForSession(m, 'S')!
    expect(after.previewTabsBySession.S).toEqual([])
    expect(after.previewBySession.S).toBeUndefined()
  })

  test('closeTabsForSession is a no-op (null) when the session has no open preview tabs', () => {
    expect(closeTabsForSession(empty, 'S')).toBeNull()
    expect(closeTabsForSession(empty, 'S', 'a')).toBeNull()
  })

  test('discarding a deleted session removes its persisted keys without touching another session', () => {
    const both = recordPreview(recordPreview(empty, 'S', entry('a')), 'T', entry('b'))
    const after = discardSessionPreviews(both, 'S')!

    expect(after.previewBySession.S).toBeUndefined()
    expect(after.previewTabsBySession.S).toBeUndefined()
    expect(after.previewBySession.T?.previewId).toBe('b')
    expect(after.previewTabsBySession.T?.map((value) => value.previewId)).toEqual(['b'])
  })

  test('activatePreview rejects unknown ids', () => {
    const m = recordPreview(empty, 'S', entry('a'))
    expect(activatePreview(m, 'S', 'a')!.S.previewId).toBe('a')
    expect(activatePreview(m, 'S', 'missing')).toBeNull()
  })
})
