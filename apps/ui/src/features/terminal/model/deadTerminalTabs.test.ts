import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { emptyEditorState, useGridStore, type WorkItem } from '@/features/workspace-grid/model'
import { backendClient } from '@/shared/api/client'
import { closeDeadTerminalTabs, sweepDeadTerminalTabs } from './deadTerminalTabs'

const original = useGridStore.getState()
let restore: (() => void) | undefined

beforeEach(() => useGridStore.setState(emptyEditorState('test-group')))
afterEach(() => {
  restore?.()
  restore = undefined
  useGridStore.setState(original)
})

function open(id: string, sessionId = 'visible', owned = true): WorkItem {
  const grid = useGridStore.getState()
  grid.openItem({
    id: `terminal:${id}`,
    kind: 'terminal',
    title: 'Terminal',
    scope: sessionId,
    payload: { terminalId: id, sessionId, owned },
  })
  return useGridStore.getState().items[`terminal:${id}`]!
}

const items = () => Object.keys(useGridStore.getState().items)

test('a confirmed exit closes hidden and adopted terminals and cannot be reopened from history', () => {
  open('alive')
  open('dead', 'hidden', false)
  useGridStore.getState().setActiveScope('visible')
  closeDeadTerminalTabs('dead')
  expect(items()).toEqual(['terminal:alive'])
  expect(useGridStore.getState().closed).toEqual([])
  useGridStore.getState().reopenClosedTab()
  expect(items()).toEqual(['terminal:alive'])
})

test('a successful snapshot removes restored dead panes in every scope and retains live panes', async () => {
  open('alive')
  open('dead-shell')
  open('dead-agent', 'hidden', false)
  const list = spyOn(backendClient, 'listTerminals').mockResolvedValue([{ id: 'alive' }] as never)
  restore = () => list.mockRestore()
  await sweepDeadTerminalTabs()
  expect(items()).toEqual(['terminal:alive'])
  expect(useGridStore.getState().closed).toEqual([])
})

test('a failed registry request never treats an unavailable runtime as dead processes', async () => {
  open('alive')
  const list = spyOn(backendClient, 'listTerminals').mockRejectedValue(new Error('offline'))
  restore = () => list.mockRestore()
  await expect(sweepDeadTerminalTabs()).rejects.toThrow('offline')
  expect(items()).toEqual(['terminal:alive'])
})

test('a terminal opened while the snapshot is in flight survives its stale answer', async () => {
  open('dead')
  let answer!: (rows: Awaited<ReturnType<typeof backendClient.listTerminals>>) => void
  const list = spyOn(backendClient, 'listTerminals').mockImplementation(
    () => new Promise((resolve) => (answer = resolve)),
  )
  restore = () => list.mockRestore()
  const sweep = sweepDeadTerminalTabs()
  open('new')
  answer([])
  await sweep
  expect(items()).toEqual(['terminal:new'])
})

test('a retired cleanup cannot close tabs after the workspace unmounts', async () => {
  open('keep')
  const list = spyOn(backendClient, 'listTerminals').mockResolvedValue([])
  restore = () => list.mockRestore()
  await sweepDeadTerminalTabs(() => false)
  expect(items()).toEqual(['terminal:keep'])
})

test('an already closed dead terminal is removed from the reopen stack', async () => {
  open('dead')
  const grid = useGridStore.getState()
  grid.closeTab(grid.activeGroup, 'terminal:dead')
  expect(useGridStore.getState().closed).toHaveLength(1)
  const list = spyOn(backendClient, 'listTerminals').mockResolvedValue([])
  restore = () => list.mockRestore()
  await sweepDeadTerminalTabs()
  expect(useGridStore.getState().closed).toEqual([])
})
