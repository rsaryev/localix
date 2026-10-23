import { describe, expect, test } from 'bun:test'
import { REQUEST_MOVE_MIME, moveTarget, readMovedRequest } from './moveRequest'

describe('where a dropped request lands', () => {
  test('into a folder, keeping its leaf name', () => {
    expect(moveTarget('list', 'users')).toBe('users/list')
  })

  test('out to the collection root', () => {
    expect(moveTarget('users/list', '')).toBe('list')
  })

  test('between folders, at any depth', () => {
    expect(moveTarget('users/list', 'admin/reports')).toBe('admin/reports/list')
  })

  test('the LEAF travels, not the path — a move is not a rename', () => {
    expect(moveTarget('a/b/c/thing', 'x')).toBe('x/thing')
  })
})

describe('drops that are refused', () => {
  test('onto the folder it is already in', () => {
    // Null rather than the unchanged name: the caller lights up a target only for a real move,
    // and a folder that accepts a drag it will ignore is a worse lie than one that refuses.
    expect(moveTarget('users/list', 'users')).toBeNull()
  })

  test('a root request dropped on the root', () => {
    expect(moveTarget('ping', '')).toBeNull()
  })

  test('onto itself, or into its own descendant', () => {
    // Cannot happen while only leaves drag; it is the invariant that keeps a future FOLDER drag
    // from detaching a subtree into a path underneath the node being moved.
    expect(moveTarget('users', 'users')).toBeNull()
    expect(moveTarget('users', 'users/admin')).toBeNull()
  })
})

describe('the transport', () => {
  test('reads the dragged name back', () => {
    const dt = { getData: (type: string) => (type === REQUEST_MOVE_MIME ? 'users/list' : '') }
    expect(readMovedRequest(dt)).toBe('users/list')
  })

  test('a drag carrying only a chat binding is not a move', () => {
    // The same row advertises both MIMEs. The tree must ignore the one meant for the composer.
    const dt = { getData: () => '' }
    expect(readMovedRequest(dt)).toBeNull()
  })
})
