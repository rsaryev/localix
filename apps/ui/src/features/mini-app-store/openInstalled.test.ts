import { afterEach, expect, test } from 'bun:test'
import { makeListing } from '@localixai/store/testing'
import { setEnabledMiniAppNames } from '@/shared/contrib/miniAppActivation'
import { railViewletRegistry } from '@/shared/contrib/uiContrib'
import { openInstalledMiniApp } from './openInstalled'

afterEach(() => {
  railViewletRegistry.removeOwner('kanban')
  setEnabledMiniAppNames(new Set())
})

test('an app a marketplace installed opens its screen, found by its name, not its identity', () => {
  setEnabledMiniAppNames(new Set(['kanban']))
  railViewletRegistry.register({
    kind: 'kanban-board',
    label: 'Kanban board',
    title: 'Kanban board',
    defaultArea: 'top',
    miniAppName: 'kanban',
  } as never)
  const kanban = makeListing({ id: 'kanban@localix', name: 'kanban', displayName: 'Kanban board' })
  expect(openInstalledMiniApp(kanban)).toBe('localix://ui/work-item/viewlet/kanban-board')
  // An app with no screen of its own has nothing to open.
  expect(openInstalledMiniApp(makeListing({ id: 'notes@localix', name: 'notes' }))).toBeUndefined()
})
