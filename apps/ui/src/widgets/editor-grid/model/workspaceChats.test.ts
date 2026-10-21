import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { groupOfTab, useGridStore, type WorkItem } from '@/entities/workspace-grid/model'
import { setWorkspaceResolver } from '@/shared/lib/workspaceOf'
import { syncGridChatSelection } from './useGridChatSync'
import { followShownChat } from './workspaceChats'

// `sub-*` sessions are sub-sessions of `root`; every other session is its own root.
const get = () => useGridStore.getState()
const select = (sessionId: string, seededFor: string | null = null) =>
  syncGridChatSelection(get(), sessionId, sessionId, seededFor)
const file = (path: string, scope: string): WorkItem => ({
  kind: 'file',
  id: `file:${path}`,
  title: path,
  scope,
})
const groupOf = (id: string) => groupOfTab(get().root, id)!.id

beforeEach(() => {
  get().resetLayout()
  setWorkspaceResolver((id) => (id.startsWith('sub-') ? 'root' : null))
})

afterEach(() => {
  setWorkspaceResolver(() => null)
})

describe('a sub-session works in its root conversation’s workspace', () => {
  test('stepping into it changes the chat, not the workbench', () => {
    // Every surface used to be keyed by the session itself: entering a sub-session swapped the
    // whole workbench, and what it opened was out of sight from its parent.
    select('root')
    get().openItem(file('notes.md', 'sub-1'))
    select('sub-1', 'root')

    expect(get().activeScope).toBe('root')
    expect(get().items['file:notes.md']?.scope).toBe('root')
    expect(get().items['chat:sub-1']?.scope).toBe('root')
    expect(get().items['chat:root']?.scope).toBe('root')
  })

  test('returning to a sub-session brings its chat tab forward over its parent’s', () => {
    select('root')
    select('sub-1', 'root')
    select('root', 'sub-1')
    expect(groupOfTab(get().root, 'chat:root')?.activeTab).toBe('chat:root')

    select('sub-1', 'root')
    expect(groupOfTab(get().root, 'chat:sub-1')?.activeTab).toBe('chat:sub-1')
  })

  test('a chat tab restored with its own scope is moved into the workspace', () => {
    // Without the restamp it stays hidden in the shared scope, and the shown chat (its parent's)
    // would route the person straight back out of the sub-session.
    get().openItem({
      kind: 'chat',
      id: 'chat:sub-1',
      title: 'Sub',
      scope: 'stale-scope',
      payload: { sessionId: 'sub-1' },
    })
    select('sub-1')
    expect(get().items['chat:sub-1']?.scope).toBe('root')
  })
})

describe('the chat on screen follows into the active session', () => {
  function follow(active: string) {
    const went: string[] = []
    const stop = followShownChat(
      () => active,
      (id) => went.push(id),
    )
    return { went, stop }
  }

  test('showing a sibling’s chat, or closing the shown one, navigates to what is shown', () => {
    select('root')
    select('sub-1', 'root')
    const clicked = follow('sub-1')
    get().setActiveTab(groupOf('chat:root'), 'chat:root')
    clicked.stop()
    expect(clicked.went).toEqual(['root'])

    select('sub-1', 'root')
    const closed = follow('sub-1')
    get().closeTab(groupOf('chat:sub-1'), 'chat:sub-1')
    closed.stop()
    expect(closed.went).toEqual(['root'])
  })

  test('a write that changes no shown chat, or another workspace’s, never navigates', () => {
    select('root')
    select('sub-1', 'root')
    const revealed = follow('sub-1')
    get().openItem(file('a.ts', 'root'))
    revealed.stop()
    expect(revealed.went).toEqual([])

    // The route already moved to another conversation; until the grid catches up, its old chat
    // is still on screen and must not pull the route back.
    const elsewhere = follow('other')
    get().setActiveTab(groupOf('chat:root'), 'chat:root')
    elsewhere.stop()
    expect(elsewhere.went).toEqual([])
  })
})
