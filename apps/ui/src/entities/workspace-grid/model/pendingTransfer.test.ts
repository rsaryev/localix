import { afterEach, expect, test } from 'bun:test'
import { emptyEditorState, groupOfTab, useGridStore } from './index'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'

const original = useGridStore.getState()
afterEach(() => {
  workItemTransferState.finish('terminal:moving')
  useGridStore.setState(original)
})

test('all tab closers preserve a pending handoff; other tabs can still close', () => {
  useGridStore.setState(emptyEditorState('root'))
  const grid = useGridStore.getState()
  grid.openItem({ id: 'terminal:moving', kind: 'terminal', title: 'Moving', scope: 's1' })
  grid.openItem({ id: 'terminal:other', kind: 'terminal', title: 'Other', scope: 's1' })
  const group = groupOfTab(useGridStore.getState().root, 'terminal:moving')!.id
  workItemTransferState.begin('terminal:moving')
  grid.closeTab(group, 'terminal:moving')
  expect(useGridStore.getState().items['terminal:moving']).toBeDefined()
  grid.resetLayout()
  expect(useGridStore.getState().items['terminal:moving']).toBeDefined()
  grid.closeTabs(group, ['terminal:moving', 'terminal:other'])
  expect(useGridStore.getState().items['terminal:moving']).toBeDefined()
  expect(useGridStore.getState().items['terminal:other']).toBeUndefined()
  workItemTransferState.finish('terminal:moving')
  grid.closeTab(group, 'terminal:moving')
  expect(useGridStore.getState().items['terminal:moving']).toBeUndefined()
})
