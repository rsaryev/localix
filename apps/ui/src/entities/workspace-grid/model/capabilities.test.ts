import { afterEach, describe, expect, test } from 'bun:test'
import {
  scopeKindOf,
  isSingleton,
  isRestorable,
  isEphemeralItem,
  isCappedFileItem,
  isPinnedItem,
  isPathBacked,
  isPendingContributedKind,
  activeWorkItemContribution,
  capsOf,
} from './capabilities'
import type { WorkItem, WorkItemKind } from '@/shared/lib/workItem'
import { miniAppUiHostFor } from '@/shared/contrib/host'
import { setEnabledMiniAppNames } from '@/shared/contrib/miniAppActivation'

afterEach(() => setEnabledMiniAppNames(null))

const item = (kind: WorkItemKind, ephemeral?: boolean): WorkItem => ({
  kind,
  id: 'x',
  title: 't',
  ...(ephemeral !== undefined ? { ephemeral } : {}),
})

describe('scopeKindOf', () => {
  test('defaults to session for kinds without an explicit scope', () => {
    expect(scopeKindOf('chat')).toBe('session')
    expect(scopeKindOf('file')).toBe('session')
    expect(scopeKindOf('diff')).toBe('session')
    expect(scopeKindOf('table')).toBe('session')
    // terminal is a normal session-scoped tab (one per backend PTY).
    expect(scopeKindOf('terminal')).toBe('session')
  })

  test('app-level kinds are global', () => {
    for (const k of ['stats', 'settings', 'agent'] as const) {
      expect(scopeKindOf(k)).toBe('global')
    }
  })

  test('every panel that reads a session belongs to one', () => {
    // Problems, Activity, Search, the Browser and mini app views used to be global and follow the
    // chat on screen; each now belongs to the chat it was opened in.
    for (const k of [
      'problems',
      'message-replay',
      'global-search',
      'preview',
      'mini-app-view',
    ] as const) {
      expect(scopeKindOf(k)).toBe('session')
    }
  })
})

describe('isSingleton', () => {
  test('one-instance viewlets are singletons; content tabs are not', () => {
    for (const k of ['preview', 'stats', 'problems', 'settings', 'message-replay'] as const) {
      expect(isSingleton(k)).toBe(true)
    }
    for (const k of [
      'chat',
      'file',
      'diff',
      'table',
      'agent',
      'transcript',
      'live-file-change',
      'mini-app-view',
      'terminal',
    ] as const) {
      expect(isSingleton(k)).toBe(false)
    }
  })
})

describe('isRestorable', () => {
  test('restorable kinds survive a reload; transient ones do not', () => {
    expect(isRestorable('chat')).toBe(true)
    expect(isRestorable('file')).toBe(true)
    expect(isRestorable('terminal')).toBe(true)
    // diff/live-file-change/transcript/task aren't restorable; message-replay
    // can't be (its content lives in the focus store, empty after reload).
    expect(isRestorable('diff')).toBe(false)
    expect(isRestorable('live-file-change')).toBe(false)
    expect(isRestorable('message-replay')).toBe(false)
    expect(isRestorable('transcript')).toBe(false)
  })
})

describe('capsOf', () => {
  test('a kind with an empty cap entry reads all-false', () => {
    expect(capsOf('transcript')).toEqual({})
    expect(isSingleton('transcript')).toBe(false)
    expect(isRestorable('transcript')).toBe(false)
  })

  test('an unknown kind falls back to the empty cap', () => {
    expect(capsOf('not-a-real-kind' as WorkItemKind)).toEqual({})
  })

  test('pending mini app ownership waits only for mini-app-exclusive kinds', () => {
    const host = miniAppUiHostFor('pending-render-fixture')
    host.workItems.register({
      kind: 'pending-render-fixture:item',
      Component: () => null,
      Icon: () => null,
    })
    expect(() =>
      host.workItems.register({
        kind: 'chat',
        Component: () => null,
        Icon: () => null,
      }),
    ).toThrow('must be namespaced by owner "pending-render-fixture:"')

    setEnabledMiniAppNames(null)
    expect(isPendingContributedKind('pending-render-fixture:item')).toBe(true)
    expect(isPendingContributedKind('chat')).toBe(false)
  })

  test('an enabled mini app cannot replace a reserved core-kind contract', () => {
    const host = miniAppUiHostFor('core-kind-collision-fixture')
    expect(() =>
      host.workItems.register({
        kind: 'file',
        Component: () => null,
        Icon: () => null,
        restorable: false,
        scope: 'global',
      }),
    ).toThrow('must be namespaced by owner "core-kind-collision-fixture:"')

    setEnabledMiniAppNames(new Set(['core-kind-collision-fixture']))

    expect(activeWorkItemContribution('file')).toBeUndefined()
    expect(capsOf('file')).toMatchObject({
      restorable: true,
      pathBacked: true,
      countsToFileCap: true,
    })
    expect(scopeKindOf('file')).toBe('session')
  })

  test('prototype-like unknown kinds do not inherit a core capability contract', () => {
    expect(capsOf('__proto__' as WorkItemKind)).toEqual({})
    expect(isPendingContributedKind('__proto__' as WorkItemKind)).toBe(true)
    setEnabledMiniAppNames(new Set())
    expect(isPendingContributedKind('__proto__' as WorkItemKind)).toBe(false)
  })
})

describe('isEphemeralItem', () => {
  test('a live-file-change is always ephemeral, regardless of the flag', () => {
    expect(isEphemeralItem(item('live-file-change'))).toBe(true)
    expect(isEphemeralItem(item('live-file-change', false))).toBe(true)
  })

  test('a file/diff occupies the preview slot ONLY when flagged ephemeral', () => {
    expect(isEphemeralItem(item('file', true))).toBe(true)
    expect(isEphemeralItem(item('file', false))).toBe(false)
    expect(isEphemeralItem(item('file'))).toBe(false) // undefined flag → pinned
    expect(isEphemeralItem(item('diff', true))).toBe(true)
  })

  test('a kind without the ephemeral slot is never ephemeral', () => {
    expect(isEphemeralItem(item('chat', true))).toBe(false)
  })
})

describe('isCappedFileItem', () => {
  test('only real files and live streams count against the file-tab cap', () => {
    expect(isCappedFileItem(item('file'))).toBe(true)
    expect(isCappedFileItem(item('live-file-change'))).toBe(true)
    expect(isCappedFileItem(item('diff'))).toBe(false)
    expect(isCappedFileItem(item('chat'))).toBe(false)
  })
})

describe('isPinnedItem', () => {
  test('a pinned item is a file/diff explicitly NOT ephemeral', () => {
    expect(isPinnedItem(item('file', false))).toBe(true)
    expect(isPinnedItem(item('diff', false))).toBe(true)
  })

  test('ephemeral or non-file/diff or missing items are not pinned', () => {
    expect(isPinnedItem(item('file', true))).toBe(false)
    expect(isPinnedItem(item('file'))).toBe(false) // undefined flag ≠ pinned (needs explicit false)
    expect(isPinnedItem(item('chat', false))).toBe(false)
    expect(isPinnedItem(undefined)).toBe(false)
  })

  test('an always-ephemeral stream rides the slot but is never pinnable', () => {
    // live-file-change has ephemeralSlot AND alwaysEphemeral — even with the flag
    // explicitly false it must not read as a pinned, slot-surviving tab.
    expect(isPinnedItem(item('live-file-change', false))).toBe(false)
  })
})

describe('isPathBacked', () => {
  test('only file/diff are workspace-path-backed (drives the file-tree highlight)', () => {
    expect(isPathBacked('file')).toBe(true)
    expect(isPathBacked('diff')).toBe(true)
    expect(isPathBacked('live-file-change')).toBe(false) // path is nested under payload.change, not payload.path
    expect(isPathBacked('terminal')).toBe(false)
    expect(isPathBacked('table')).toBe(false)
  })
})
