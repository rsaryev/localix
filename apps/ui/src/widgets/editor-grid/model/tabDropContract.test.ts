import { describe, expect, test } from 'bun:test'
import type { WorkItem } from '@/shared/lib/workItem'
import {
  readMessageBindingDrag,
  setMessageBindingDrag,
  messageBindingDragKind,
  WORKSPACE_TAB_DRAG_MIME,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { acceptedDragKind } from '@/entities/chat/ui/prompt-input/dropzoneState'
import { workItemKindRegistry } from '@/shared/contrib/uiContrib'
import { workItemToMessageBinding } from '@/entities/workspace-grid/model'

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

/** A legacy window can still advertise a tab and a context payload together. */
function armTabDrag(item: WorkItem): DataTransfer {
  const dt = fakeDataTransfer()
  dt.setData(WORKSPACE_TAB_DRAG_MIME, item.id)
  const binding = workItemToMessageBinding(item)
  if (binding) setMessageBindingDrag(dt, binding)
  return dt
}

const item = (over: Partial<WorkItem>): WorkItem => ({ kind: 'file', id: 'x', title: 'X', ...over })
const COMPOSER = { messageBinding: true, attach: true } as const

describe('tab drags never link into the composer', () => {
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
    test(`${c.name} remains movable without advertising a message link`, () => {
      const dt = armTabDrag(c.item)
      expect(dt.types).toContain(WORKSPACE_TAB_DRAG_MIME)
      expect(acceptedDragKind(Array.from(dt.types), COMPOSER)).toBeNull()
      expect(readMessageBindingDrag(dt)).toBeNull()
      expect(messageBindingDragKind(Array.from(dt.types))).toBeNull()
    })
  }

  test('a non-linkable tab (settings) arms nothing — the composer ignores the drag', () => {
    const dt = armTabDrag(item({ kind: 'settings', id: 'settings', title: 'Settings' }))
    // Only the internal tab MIME rode along → the composer ignores it.
    expect(acceptedDragKind(Array.from(dt.types), COMPOSER)).toBeNull()
    expect(readMessageBindingDrag(dt)).toBeNull()
  })
})
