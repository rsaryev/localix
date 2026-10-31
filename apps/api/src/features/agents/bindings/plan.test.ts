import { describe, expect, test } from 'bun:test'
import { GRACE_MS, groupKey, planBindings, type BoundRow, type FoundAgent } from './plan'

const user = { projectId: '', source: 'user' }
const row = (id: string, name: string, path: string, bodyHash = id, extra = {}): BoundRow => ({
  ...user,
  id,
  name,
  path,
  bodyHash,
  ...extra,
})
const found = (name: string, path: string, bodyHash: string, group = user): FoundAgent => ({
  ...group,
  name,
  path,
  bodyHash,
})
const scanned = new Set([groupKey(user)])
let counter = 0
const plan = (rows: BoundRow[], items: FoundAgent[], now = 0) =>
  planBindings({
    rows,
    found: items,
    scanned,
    gone: new Set(),
    now,
    newId: () => `new-${++counter}`,
  })

describe('agent binding plan', () => {
  test('a new file gets a fresh id and an unchanged one writes nothing', () => {
    const items = [found('a', '/u/a.md', 'h1'), found('b', '/u/b.md', 'h2')]
    const result = plan([row('id-a', 'a', '/u/a.md', 'h1')], items)
    expect(result.create.map((c) => [c.found.name, c.id])).toEqual([['b', 'new-1']])
    expect(result.update).toEqual([])
    expect(result.ids.get(items[0]!)).toBe('id-a')
  })

  test('an edit in place keeps the id', () => {
    const result = plan([row('id-a', 'a', '/u/a.md', 'h1')], [found('a', '/u/a.md', 'h2')])
    expect(result.update).toMatchObject([{ row: { id: 'id-a' }, renamed: false }])
    expect(result.create).toEqual([])
  })

  test('a new name at the same path is a rename of the same identity', () => {
    const result = plan([row('id-a', 'a', '/u/a.md', 'h1')], [found('b', '/u/a.md', 'h1')])
    expect(result.update).toMatchObject([
      { row: { id: 'id-a' }, found: { name: 'b' }, renamed: true },
    ])
  })

  test('a moved file keeps its name and its id', () => {
    const result = plan([row('id-a', 'a', '/u/a.md', 'h1')], [found('a', '/u/sub/a.md', 'h1')])
    expect(result.update).toMatchObject([{ row: { id: 'id-a' }, renamed: false }])
    expect(result.missing).toEqual([])
  })

  test('a new path and name with the same body is a rename; a different body is not', () => {
    const same = plan([row('id-a', 'a', '/u/a.md', 'h1')], [found('b', '/u/b.md', 'h1')])
    expect(same.update).toMatchObject([{ row: { id: 'id-a' }, renamed: true }])
    const other = plan([row('id-a', 'a', '/u/a.md', 'h1')], [found('b', '/u/b.md', 'h2')])
    expect(other.create.map((c) => c.found.name)).toEqual(['b'])
    expect(other.missing.map((r) => r.id)).toEqual(['id-a'])
  })

  test('a body two new files share is not enough to call either a rename', () => {
    const result = plan(
      [row('id-a', 'a', '/u/a.md', 'h1')],
      [found('b', '/u/b.md', 'h1'), found('c', '/u/c.md', 'h1')],
    )
    expect(result.create).toHaveLength(2)
    expect(result.missing).toHaveLength(1)
  })

  test('a vanished file is missing, then purged after the grace, unless it returns', () => {
    const rows = [row('id-a', 'a', '/u/a.md')]
    const first = plan(rows, [], 1000)
    expect(first.missing.map((r) => r.id)).toEqual(['id-a'])
    const at = new Date(1000).toISOString()
    const missing = [row('id-a', 'a', '/u/a.md', 'id-a', { missingSince: at })]
    expect(plan(missing, [], 1000 + GRACE_MS - 1).purge).toEqual([])
    expect(plan(missing, [], 1000 + GRACE_MS).purge.map((r) => r.id)).toEqual(['id-a'])
    const back = plan(missing, [found('a', '/u/a.md', 'id-a')], 1000 + 5)
    expect(back.update).toMatchObject([{ row: { id: 'id-a' } }])
    expect(back.purge).toEqual([])
  })

  test('a group that was not scanned is left alone and a gone one is purged', () => {
    const plugin = { projectId: '', source: 'plugin:acme' }
    const project = { projectId: 'p', source: 'project' }
    const rows: BoundRow[] = [
      { ...plugin, id: 'id-plugin', name: 'acme:a', path: '', bodyHash: 'x' },
      { ...project, id: 'id-project', name: 'p1', path: '/p/p1.md', bodyHash: 'y' },
    ]
    const untouched = plan(rows, [])
    expect(untouched.missing).toEqual([])
    expect(untouched.purge).toEqual([])
    const gone = planBindings({
      rows,
      found: [],
      scanned,
      gone: new Set([groupKey(plugin)]),
      now: 0,
      newId: () => 'x',
    })
    expect(gone.purge.map((r) => r.id)).toEqual(['id-plugin'])
  })
})
