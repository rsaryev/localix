import { expect, test } from 'bun:test'
import { createProvisionalWindowDrag, type WindowDragPacket } from './provisionalWindowDrag'

const packet: WindowDragPacket = {
  route: '/project/project/session',
  payload: {
    version: 1,
    projectId: 'project',
    sessionId: 'session',
    item: { id: 'chat:session', kind: 'chat', title: 'Chat', scope: 'session' },
  },
}
function fixture() {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = []
  let complete!: (value: string) => void
  let fail!: (error: Error) => void
  const prepared = new Promise<string>((resolve, reject) => {
    complete = resolve
    fail = reject
  })
  let sequence = 0
  const drag = createProvisionalWindowDrag({
    id: () => `drag-${++sequence}`,
    invoke: <T>(command: string, args: Record<string, unknown>) => {
      calls.push({ command, args })
      return (
        command === 'workspace_drag_prepare' ? prepared : Promise.resolve('target')
      ) as Promise<T>
    },
  })
  return { drag, calls, complete, fail }
}

test('the same held gesture prepares once and promotes its window only after preparation', async () => {
  const { drag, calls, complete } = fixture()
  drag.begin('session:session', packet)
  drag.begin('session:session', packet)
  // Object field ordering at the call site does not make a fresh snapshot.
  const moved = drag.claim(
    'session:session',
    { payload: packet.payload, route: packet.route },
    'tab',
  )
  expect(calls.map((call) => call.command)).toEqual(['workspace_drag_prepare'])
  drag.cancel() // Source dragend/unmount must not cancel the already claimed transfer.
  complete('preview')
  expect(await moved).toBe('target')
  expect(calls[1]).toEqual({
    command: 'workspace_drag_commit',
    args: { id: 'drag-1', asTab: true },
  })
})

test('cancelling while preparation is in flight sends a tombstone and cannot later promote it', async () => {
  const { drag, calls, complete } = fixture()
  drag.begin('item:browser', packet)
  drag.cancel('item:other')
  expect(calls).toHaveLength(1)
  drag.cancel('item:browser')
  complete('late-preview')
  await Promise.resolve()
  expect(drag.claim('item:browser', packet, 'window')).toBeNull()
  expect(calls.map((call) => call.command)).toEqual([
    'workspace_drag_prepare',
    'workspace_drag_cancel',
  ])
})

test('changed content cancels the stale prepared window and leaves a fresh transfer to the caller', () => {
  const { drag, calls } = fixture()
  drag.begin('item:file', packet)
  expect(
    drag.claim(
      'item:file',
      {
        ...packet,
        payload: { ...packet.payload, item: { ...packet.payload.item, title: 'Changed' } },
      },
      'window',
    ),
  ).toBeNull()
  expect(calls[1].command).toBe('workspace_drag_cancel')
})

test('a failed preview can still use the existing release-time transfer', async () => {
  const { drag, calls, fail } = fixture()
  drag.begin('session:session', packet)
  fail(new Error('Preparation failed'))
  expect(await drag.claim('session:session', packet, 'window')).toBe('target')
  expect(calls[1]).toEqual({
    command: 'workspace_transfer_open',
    args: { ...packet, asTab: false },
  })
})

test('a new gesture cancels the old ID before preparing its own provisional window', () => {
  const { drag, calls } = fixture()
  drag.begin('item:one', packet)
  const previous = drag.revision()
  drag.begin('item:two', packet)
  expect(drag.revision()).toBeGreaterThan(previous)
  expect(calls.map((call) => [call.command, call.args.id])).toEqual([
    ['workspace_drag_prepare', 'drag-1'],
    ['workspace_drag_cancel', 'drag-1'],
    ['workspace_drag_prepare', 'drag-2'],
  ])
})

test('prepares a content snapshot once without changing the transferable packet identity', async () => {
  const { drag, calls, complete } = fixture()
  const snapshot = { rect: [100, 50, 400, 300] as [number, number, number, number] }
  drag.begin('session:session', packet, [120, 20], snapshot)
  expect(calls[0].args).toEqual({ id: 'drag-1', ...packet, anchor: [120, 20], snapshot })
  complete('preview')
  expect(await drag.claim('session:session', packet, 'window')).toBe('target')
  expect(calls.map(({ command }) => command)).toEqual([
    'workspace_drag_prepare',
    'workspace_drag_commit',
  ])
})
