import { describe, expect, test } from 'bun:test'
import { makeLeaf, type WorkItem } from '@/entities/workspace-grid/model'
import { syncGridChatSelection } from './useGridChatSync'

function bridge() {
  const events: string[] = []
  const items: Record<string, WorkItem> = {}
  return {
    events,
    grid: {
      items,
      // No item here sits in a group, so no sibling chat is ever shown in these cases.
      root: makeLeaf('chat-group'),
      scopeActiveTab: {},
      setActiveTab: (_group: string, id: string) => {
        events.push(`activate:${id}`)
      },
      resolveRoleGroup: () => 'chat-group',
      openItem: (item: WorkItem) => {
        events.push(`open:${item.id}`)
        items[item.id] = item
      },
      setActiveScope: (scope: string) => {
        events.push(`scope:${scope}`)
      },
      setTabTitle: (id: string, title: string) => {
        events.push(`title:${id}:${title}`)
        items[id] = { ...items[id]!, title }
      },
    },
  }
}

describe('syncGridChatSelection', () => {
  test('seeds a new session tab before exposing its scope', () => {
    const { grid, events } = bridge()

    expect(syncGridChatSelection(grid, 'session-b', 'Second chat', 'session-a')).toBe('session-b')
    expect(events).toEqual(['open:chat:session-b', 'scope:session-b'])
  })

  test('does not reopen a user-closed tab while refreshing the same session', () => {
    const { grid, events } = bridge()

    syncGridChatSelection(grid, 'session-a', 'Renamed', 'session-a')
    expect(events).toEqual(['scope:session-a'])
  })

  test('refreshes a live same-session tab before keeping its scope active', () => {
    const { grid, events } = bridge()
    grid.items['chat:session-a'] = {
      kind: 'chat',
      id: 'chat:session-a',
      title: 'Old',
      scope: 'session-a',
    }

    syncGridChatSelection(grid, 'session-a', 'Renamed', 'session-a')
    expect(events).toEqual(['title:chat:session-a:Renamed', 'scope:session-a'])
  })

  test('does not reactivate an existing chat when returning to a restored session', () => {
    const { grid, events } = bridge()
    grid.items['chat:session-a'] = {
      kind: 'chat',
      id: 'chat:session-a',
      title: 'Chat',
      scope: 'session-a',
    }

    syncGridChatSelection(grid, 'session-a', 'Chat', null)
    expect(events).toEqual(['scope:session-a'])
  })

  test('clears the seed and reveals the global scope without a session', () => {
    const { grid, events } = bridge()

    expect(syncGridChatSelection(grid, null, null, 'session-a')).toBeNull()
    expect(events).toEqual(['scope:@global'])
  })

  test('the launch selection opens its chat tab, so a window always starts in a chat', () => {
    const { grid, events } = bridge()

    expect(syncGridChatSelection(grid, 'draft', 'New Chat', null)).toBe('draft')
    expect(events).toEqual(['open:chat:draft', 'scope:draft'])
  })
})
