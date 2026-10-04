import { afterEach, describe, expect, test } from 'bun:test'
import { create } from 'zustand'

import { setWorkspaceResolver, workspaceOf } from '@/shared/lib/workspaceOf'
import { registerWorkspaceRoots } from './workspaceRoots'

type Row = { id: string; rootSessionId?: string | null }

function sessionStore(rows: Row[]) {
  return create<{ sessions: Row[]; allSessions: Row[] }>()(() => ({
    sessions: [],
    allSessions: rows,
  }))
}

let stop: (() => void) | undefined
afterEach(() => {
  stop?.()
  stop = undefined
  setWorkspaceResolver(() => null)
})

describe('a session’s root, once seen, is kept', () => {
  test('a sub-session evicted from the list still answers with its root', () => {
    // The list prunes finished sub-sessions (and running ones past its cap), and a cold start
    // replaces it wholesale. Read only off the list, the evicted sub-session became its own root
    // and its next page or pane opened in a workspace of its own.
    const store = sessionStore([{ id: 'root' }, { id: 'sub-1', rootSessionId: 'root' }])
    stop = registerWorkspaceRoots(store)
    expect(workspaceOf('sub-1')).toBe('root')

    store.setState({ allSessions: [{ id: 'root' }] })
    expect(workspaceOf('sub-1')).toBe('root')
  })

  test('one that arrives later is learned, and one never seen is its own root', () => {
    const store = sessionStore([{ id: 'root' }])
    stop = registerWorkspaceRoots(store)
    store.setState({ allSessions: [{ id: 'root' }, { id: 'sub-2', rootSessionId: 'root' }] })

    expect(workspaceOf('sub-2')).toBe('root')
    expect(workspaceOf('unknown')).toBe('unknown')
  })
})
