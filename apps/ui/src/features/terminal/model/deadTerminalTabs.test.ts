import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { emptyEditorState, useGridStore, type WorkItem } from '@/entities/workspace-grid/model'
import { backendClient } from '@/shared/api/client'
import {
  closeDeadTerminalTabs,
  finishTerminalTabs,
  sweepDeadTerminalTabs,
} from './deadTerminalTabs'

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

test('a successful snapshot retains missing panes in every scope as unavailable', async () => {
  open('alive')
  open('dead-shell')
  open('dead-agent', 'hidden', false)
  const list = spyOn(backendClient, 'listTerminals').mockResolvedValue([{ id: 'alive' }] as never)
  restore = () => list.mockRestore()
  await sweepDeadTerminalTabs()
  expect(items()).toEqual(['terminal:alive', 'terminal:dead-shell', 'terminal:dead-agent'])
  expect(useGridStore.getState().items['terminal:dead-agent']?.payload?.terminalExit).toEqual({
    exitCode: null,
  })
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
  expect(items()).toEqual(['terminal:dead', 'terminal:new'])
  expect(useGridStore.getState().items['terminal:new']?.payload?.terminalExit).toBeUndefined()
})

test('a retired cleanup cannot close tabs after the workspace unmounts', async () => {
  open('keep')
  const list = spyOn(backendClient, 'listTerminals').mockResolvedValue([])
  restore = () => list.mockRestore()
  await sweepDeadTerminalTabs(() => false)
  expect(items()).toEqual(['terminal:keep'])
})

test('an already closed dead terminal retains its exit status when reopened', async () => {
  open('dead')
  const grid = useGridStore.getState()
  grid.closeTab(grid.activeGroup, 'terminal:dead')
  expect(useGridStore.getState().closed).toHaveLength(1)
  const list = spyOn(backendClient, 'listTerminals').mockResolvedValue([])
  restore = () => list.mockRestore()
  await sweepDeadTerminalTabs()
  expect(useGridStore.getState().closed).toHaveLength(1)
  useGridStore.getState().reopenClosedTab()
  expect(useGridStore.getState().items['terminal:dead']?.payload?.terminalExit).toEqual({
    exitCode: null,
  })
})

test('errors and successful commands remain after subsequent registry sweeps', async () => {
  open('error', 'hidden', false)
  open('success')
  finishTerminalTabs('error', { exitCode: 1, command: 'bun test' })
  finishTerminalTabs('success', { exitCode: 0, command: 'bun build' })
  const list = spyOn(backendClient, 'listTerminals').mockResolvedValue([])
  restore = () => list.mockRestore()
  await sweepDeadTerminalTabs()
  expect(items()).toEqual(['terminal:error', 'terminal:success'])
  expect(useGridStore.getState().items['terminal:error']?.payload?.terminalExit).toEqual({
    exitCode: 1,
    command: 'bun test',
  })
  finishTerminalTabs('error', { exitCode: null })
  expect(useGridStore.getState().items['terminal:error']?.payload?.terminalExit).toMatchObject({
    exitCode: 1,
  })
})

test('only a successful interactive shell exit closes the tab', () => {
  open('shell')
  open('failed-shell')
  finishTerminalTabs('failed-shell', { exitCode: 2, interactive: true })
  finishTerminalTabs('shell', { exitCode: 0, interactive: true })
  expect(items()).toEqual(['terminal:failed-shell'])
  expect(useGridStore.getState().closed).toEqual([])
})
