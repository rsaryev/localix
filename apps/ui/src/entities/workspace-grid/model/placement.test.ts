import { describe, expect, test } from 'bun:test'
import { resolveOpenTarget, roleForKind } from './placement'
import { makeLeaf, findLeafByRole, leaves, type GridNode } from './tree'
import { WORK_ITEM_CAPS } from './capabilities'
import type { WorkItemKind } from '@/shared/lib/workItem'

const ALL_KINDS = Object.keys(WORK_ITEM_CAPS) as WorkItemKind[]
const ROLES = ['editor', 'aux']

// A seeded aux base, like the live grid after chat-sync adopts the first leaf.
const auxRoot = (): GridNode => makeLeaf('aux', ['chat:s1'], 'chat:s1', 'aux')

function gen() {
  let n = 0
  return () => `g${n++}`
}

describe('placement coverage', () => {
  test('every WorkItem kind maps to a default role, and BOTH roles are in use', () => {
    // The "no fall-through" claim this test used to make was not testable here:
    // `roleForKind` ends in `?? 'editor'`, so a missing policy entry yields 'editor',
    // which is in ROLES — green. (The real no-gap guard is the type: PLACEMENT_POLICY
    // is `Record<WorkItemKind, GroupRole>`, so a gap fails to compile.)
    //
    // What the type does NOT guard, and this now does: that the aux routing still
    // exists at all. Collapsing every kind to 'editor' — losing the companion column —
    // passed the old assertion for every kind.
    const roles = ALL_KINDS.map(roleForKind)
    expect(ALL_KINDS.length).toBeGreaterThan(10)
    for (const role of roles) expect(ROLES).toContain(role)
    expect(roles).toContain('editor')
    expect(roles).toContain('aux')
  })
})

describe('placement (default: editor + aux side)', () => {
  test('documents/preview/terminal → editor; companions → aux', () => {
    expect(roleForKind('file')).toBe('editor')
    expect(roleForKind('diff')).toBe('editor')
    expect(roleForKind('settings')).toBe('editor')
    expect(roleForKind('stats')).toBe('editor')
    expect(roleForKind('chat')).toBe('aux')
    expect(roleForKind('preview')).toBe('editor') // center stage, a tab where files open
    expect(roleForKind('problems')).toBe('aux')
    expect(roleForKind('terminal')).toBe('editor') // center stage too, beside the preview
  })

  test('non-terminal companions stack as TABS in the one aux group (chat + git)', () => {
    let r = auxRoot()
    const id = gen()
    const chat = resolveOpenTarget(r, 'chat', id)
    r = chat.root
    const problems = resolveOpenTarget(r, 'problems', id)
    r = problems.root
    // Both resolve to the SAME aux group (the seed), never a new split.
    expect(chat.groupId).toBe('aux')
    expect(problems.groupId).toBe('aux')
    expect(leaves(r)).toHaveLength(1) // still a single group
  })

  test('preview opens CENTER STAGE — as a tab target in the editor group', () => {
    let r = auxRoot()
    const id = gen()
    const file = resolveOpenTarget(r, 'file', id)
    r = file.root // [editor | aux]
    const prev = resolveOpenTarget(r, 'preview', id)
    r = prev.root
    expect(prev.groupId).toBe(file.groupId) // SAME group files open into
    expect(leaves(r)).toHaveLength(2) // still just editor + aux
  })

  test('preview opened before any editor spawns the editor group (like a file)', () => {
    let r = auxRoot()
    const id = gen()
    const prev = resolveOpenTarget(r, 'preview', id)
    r = prev.root
    expect(findLeafByRole(r, 'editor')?.id).toBe(prev.groupId)
    expect(findLeafByRole(r, 'aux')?.id).toBe('aux') // chat base preserved
    expect(leaves(r)).toHaveLength(2) // editor + aux
  })

  test('an editor kind spawns the primary editor group off the aux base', () => {
    let r = auxRoot()
    const id = gen()
    const file = resolveOpenTarget(r, 'file', id)
    r = file.root
    expect(findLeafByRole(r, 'editor')?.id).toBe(file.groupId)
    expect(findLeafByRole(r, 'aux')?.id).toBe('aux') // base preserved
    expect(leaves(r)).toHaveLength(2)
  })

  test('terminal opens CENTER STAGE — as a tab target in the editor group', () => {
    let r = auxRoot()
    const id = gen()
    const file = resolveOpenTarget(r, 'file', id)
    r = file.root // [editor | aux]
    const t = resolveOpenTarget(r, 'terminal', id)
    r = t.root
    expect(t.groupId).toBe(file.groupId) // SAME group files open into
    expect(leaves(r)).toHaveLength(2) // still just editor + aux
  })

  test('terminal opened before any editor spawns the editor group (like a file)', () => {
    let r = auxRoot()
    const id = gen()
    const t = resolveOpenTarget(r, 'terminal', id)
    r = t.root
    expect(findLeafByRole(r, 'editor')?.id).toBe(t.groupId)
    expect(findLeafByRole(r, 'aux')?.id).toBe('aux') // chat base preserved
    expect(leaves(r)).toHaveLength(2) // editor + aux
  })

  test('same kind always lands in the same group regardless of open order', () => {
    let r = auxRoot()
    const id = gen()
    const a1 = resolveOpenTarget(r, 'file', id)
    r = a1.root
    const a2 = resolveOpenTarget(r, 'review', id)
    r = a2.root
    // Reopen → reveals the SAME group ids (role groups already exist).
    expect(resolveOpenTarget(r, 'file', id).groupId).toBe(a1.groupId)
    expect(resolveOpenTarget(r, 'review', id).groupId).toBe(a2.groupId)
  })

  test('editor spawns LEFT of aux as the primary, default ratio editor 62 / aux 38', () => {
    const r = resolveOpenTarget(auxRoot(), 'file', gen())
    // Root is a horizontal branch [editor, aux]; editor first (left), bigger share.
    expect(r.root.type).toBe('branch')
    if (r.root.type === 'branch') {
      expect(r.root.orientation).toBe('h')
      const editorIdx = r.root.children.findIndex((c) => c.id === r.groupId)
      expect(editorIdx).toBe(0) // editor is the FIRST (left) child
      expect(r.root.sizes[editorIdx]).toBeCloseTo(0.62, 5)
      expect(r.root.sizes[1 - editorIdx]).toBeCloseTo(0.38, 5)
    }
  })

  test('cold tree (untagged leaf) adopts the first leaf as the aux base', () => {
    const r = resolveOpenTarget(makeLeaf('seed'), 'chat', gen())
    expect(r.groupId).toBe('seed')
    expect(findLeafByRole(r.root, 'aux')?.id).toBe('seed')
  })
})
