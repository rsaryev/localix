import { expect, test } from 'bun:test'
import { groupOfTab, useGridStore } from '@/entities/workspace-grid/model'
import { workItemKindRegistry } from '@/shared/contrib/uiContrib'
import { applyGridInspectorRequest } from './useGridInspectorBus'

test('a work item opened in the background joins its group without taking the focus', () => {
  workItemKindRegistry.register({
    kind: 'background-probe',
    Component: () => null,
    Icon: () => null,
    scope: 'global',
  })
  applyGridInspectorRequest({ kind: 'settings' })
  const before = useGridStore.getState()
  const settingsGroup = groupOfTab(before.root, 'settings')!
  applyGridInspectorRequest({
    kind: 'work-item',
    workKind: 'background-probe',
    id: 'background-probe:1',
    title: 'Probe',
    scope: null,
    activate: false,
  })
  const after = useGridStore.getState()
  const group = groupOfTab(after.root, 'background-probe:1')
  expect(group).not.toBeNull()
  expect(group!.activeTab).not.toBe('background-probe:1')
  expect(groupOfTab(after.root, 'settings')!.activeTab).toBe(settingsGroup.activeTab)
  // Asked again with the focus, the same tab comes forward.
  applyGridInspectorRequest({
    kind: 'work-item',
    workKind: 'background-probe',
    id: 'background-probe:1',
    title: 'Probe',
    scope: null,
  })
  expect(groupOfTab(useGridStore.getState().root, 'background-probe:1')!.activeTab).toBe(
    'background-probe:1',
  )
})
