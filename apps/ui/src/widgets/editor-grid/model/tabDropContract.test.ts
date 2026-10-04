import { describe, expect, test } from 'bun:test'
import type { WorkItem } from '@/features/workspace-grid/model'
import {
  messageBindingToken,
  readMessageBindingDrag,
  setMessageBindingDrag,
} from '@localixai/plugin-sdk/ui/message-binding-drag'
import { acceptedDragKind } from '@/features/chat/ui/prompt-input/dropzoneState'
import { workItemKindRegistry } from '@/shared/contrib/uiContrib'
import { workItemToMessageBinding } from '@/features/workspace-grid/model'

// A subsystem-contributed tab kind that links as a `@resource:` ref (stands in for the
// database plugin's `db-console`, which registers the SAME mapping via the registry). Proves
// the contributed-tab → composer link contract without a core db literal.
workItemKindRegistry.register({
  kind: 'test-resource-tab',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: (() => null) as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Icon: (() => null) as any,
  toMessageBinding: (i) => {
    if (typeof i.payload?.connectionId !== 'string') return null
    const uri = `localix://resource/fixture-db/${i.payload.connectionId}`
    return {
      kind: 'context',
      source: 'plugin',
      target: { kind: 'resource', token: `@resource:${uri}`, label: i.title, uri },
    }
  },
})

/**
 * End-to-end contract: dragging an OPEN EDITOR TAB into the chat composer links
 * it exactly like a file-tree row drop. This exercises the REAL functions on both
 * sides of the drag — the editor-grid source (workItemToMessageBinding + the TabStrip
 * dragstart order) and the composer sink (acceptedDragKind → readMessageBindingDrag →
 * messageBindingToken) — so a future change to any MIME, mapper, or token silently
 * breaking the link trips here. (The separate half of the bug — the split shield
 * covering the composer so the drop never arrives — is guarded by
 * bodyOwnsMessageBindingDrops in dropZone.test.ts.)
 */

/** Minimal DataTransfer stand-in (bun test has no DOM). */
function fakeDataTransfer() {
  const store = new Map<string, string>()
  return {
    setData: (t: string, v: string) => {
      store.set(t, v)
    },
    getData: (t: string) => store.get(t) ?? '',
    get types() {
      return [...store.keys()]
    },
  } as unknown as DataTransfer & { types: string[] }
}

/**
 * Reproduce a tab dragstart the way TabStrip + GroupView do it: TabStrip writes
 * `text/plain` (its own reorder payload) FIRST, then GroupView's onItemDragStart
 * arms the message binding for a linkable tab. Order matters — arming must not be
 * clobbered by the reorder payload.
 */
function armTabDrag(item: WorkItem): DataTransfer {
  const dt = fakeDataTransfer()
  dt.setData('text/plain', item.id) // TabStrip reorder payload (set before onItemDragStart)
  const binding = workItemToMessageBinding(item)
  if (binding) setMessageBindingDrag(dt, binding)
  return dt
}

const item = (over: Partial<WorkItem>): WorkItem => ({ kind: 'file', id: 'x', title: 'X', ...over })
const COMPOSER = { messageBinding: true, attach: true } as const

describe('open-tab → composer link contract', () => {
  const cases: Array<{ name: string; item: WorkItem; kind: string; token: string }> = [
    {
      name: 'file tab',
      item: item({ kind: 'file', id: 'file:/a.ts', title: 'a.ts', payload: { path: '/a.ts' } }),
      kind: 'file',
      token: '@/a.ts',
    },
    {
      name: 'diff tab',
      item: item({ kind: 'diff', id: 'diff:/b.ts', title: 'b.ts', payload: { path: '/b.ts' } }),
      kind: 'file',
      token: '@/b.ts',
    },
    {
      name: 'contributed resource tab',
      item: item({
        kind: 'test-resource-tab',
        id: 'test-resource-tab:c1',
        title: 'prod',
        payload: { connectionId: 'c1' },
      }),
      kind: 'resource',
      token: '@resource:localix://resource/fixture-db/c1',
    },
    {
      name: 'terminal tab',
      item: item({
        kind: 'terminal',
        id: 'terminal:t1',
        title: 'zsh',
        payload: { terminalId: 't1' },
      }),
      kind: 'terminal',
      token: '@terminal:t1',
    },
  ]

  for (const c of cases) {
    test(`${c.name} arms a payload the composer accepts, reads, and tokenizes`, () => {
      const dt = armTabDrag(c.item)
      // Composer dragover recognizes the message-binding target kind.
      expect(acceptedDragKind(Array.from(dt.types), COMPOSER)).toBe(c.kind)
      // Composer drop: the payload reads back and turns into the expected token.
      const payload = readMessageBindingDrag(dt)
      expect(payload).not.toBeNull()
      expect(messageBindingToken(payload!)).toBe(c.token)
    })
  }

  test('a non-linkable tab (settings) arms nothing — the composer ignores the drag', () => {
    const dt = armTabDrag(item({ kind: 'settings', id: 'settings', title: 'Settings' }))
    // Only text/plain rode along → the composer does not treat it as a binding.
    expect(acceptedDragKind(Array.from(dt.types), COMPOSER)).toBeNull()
    expect(readMessageBindingDrag(dt)).toBeNull()
  })
})
