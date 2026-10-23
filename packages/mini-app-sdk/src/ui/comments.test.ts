import { afterEach, describe, expect, test } from 'bun:test'
import { useComments, groupComments, type Comment, type CommentAnchor } from './comments'

const anchor = (o: Partial<CommentAnchor> = {}): CommentAnchor => ({
  kind: 'file',
  targetId: 't',
  label: 'L',
  ...o,
})
const comment = (o: Partial<Comment> & { anchor: CommentAnchor }): Comment => ({
  id: 'i',
  scope: 's',
  body: 'b',
  ...o,
})

describe('groupComments', () => {
  test('returns no groups for an empty list', () => {
    expect(groupComments([])).toEqual([])
  })

  test('keys by anchor.groupId/groupLabel, falling back to targetId/label', () => {
    const a = comment({ id: '1', anchor: anchor({ targetId: 'a.ts', label: 'Line 1' }) })
    const b = comment({
      id: '2',
      anchor: anchor({ groupId: 'g', groupLabel: 'Group', targetId: 'x', label: 'Lx' }),
    })
    const groups = groupComments([a, b])
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ groupId: 'a.ts', groupLabel: 'Line 1' }) // fallback
    expect(groups[1]).toMatchObject({ groupId: 'g', groupLabel: 'Group' }) // explicit
  })

  test('collects same-group comments together, preserving first-seen group order', () => {
    const c1 = comment({ id: '1', anchor: anchor({ groupId: 'B' }) })
    const c2 = comment({ id: '2', anchor: anchor({ groupId: 'A' }) })
    const c3 = comment({ id: '3', anchor: anchor({ groupId: 'B' }) })
    const groups = groupComments([c1, c2, c3])
    expect(groups.map((g) => g.groupId)).toEqual(['B', 'A']) // first-seen, not sorted
    expect(groups[0].items.map((i) => i.id)).toEqual(['1', '3'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['2'])
  })
})

describe('useComments store', () => {
  afterEach(() => useComments.setState({ comments: [] }))

  test('add appends a comment and returns its id', () => {
    const id = useComments.getState().add('s1', anchor({ targetId: 'a.ts' }), 'hello')
    const all = useComments.getState().comments
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id, scope: 's1', body: 'hello' })
    expect(all[0].anchor.targetId).toBe('a.ts')
  })

  test('setBody updates only the targeted comment', () => {
    const a = useComments.getState().add('s', anchor(), 'a')
    const b = useComments.getState().add('s', anchor(), 'b')
    useComments.getState().setBody(a, 'edited')
    const byId = Object.fromEntries(useComments.getState().comments.map((c) => [c.id, c.body]))
    expect(byId[a]).toBe('edited')
    expect(byId[b]).toBe('b')
  })

  test('remove drops only the targeted comment', () => {
    const a = useComments.getState().add('s', anchor(), 'a')
    const b = useComments.getState().add('s', anchor(), 'b')
    useComments.getState().remove(a)
    expect(useComments.getState().comments.map((c) => c.id)).toEqual([b])
  })

  test('clearScope removes a scope’s comments and keeps the rest', () => {
    useComments.getState().add('s1', anchor(), 'one')
    useComments.getState().add('s2', anchor(), 'two')
    useComments.getState().add('s1', anchor(), 'three')
    useComments.getState().clearScope('s1')
    const left = useComments.getState().comments
    expect(left).toHaveLength(1)
    expect(left[0].scope).toBe('s2')
  })
})
