import { expect, test } from 'bun:test'
import type { ModPaneRef } from '@/shared/api/modsApi'
import { modPaneTabId, planPaneTabs } from './paneTabs'

const pane = (id: string, extra: Partial<ModPaneRef> = {}): ModPaneRef => ({
  instance: 'gauge@p1',
  plugin: 'gauge',
  id,
  title: `Pane ${id}`,
  cwd: '/work/p1',
  closeOnEscape: false,
  focusRequest: 0,
  ...extra,
})

test('a pane the mod opened gets a tab in the background; one it asked forward opens focused', () => {
  const quiet = pane('log')
  const asked = pane('diff', { focusRequest: 1 })
  const plan = planPaneTabs({
    panes: [quiet, asked],
    openTabs: [],
    asked: [asked],
    held: new Set(),
  })
  expect(plan.open).toEqual([
    { pane: quiet, focus: false },
    { pane: asked, focus: true },
  ])
  expect(plan.close).toEqual([])
})

test('an open tab is left alone, unless its pane was asked forward again', () => {
  const diff = pane('diff', { focusRequest: 2 })
  const open = [modPaneTabId(diff)]
  expect(planPaneTabs({ panes: [diff], openTabs: open, asked: [], held: new Set() })).toEqual({
    open: [],
    close: [],
  })
  expect(
    planPaneTabs({ panes: [diff], openTabs: open, asked: [diff], held: new Set() }).open,
  ).toEqual([{ pane: diff, focus: true }])
})

test('a tab whose pane is gone closes: restored after a reload, or closed by its mod', () => {
  const plan = planPaneTabs({
    panes: [],
    openTabs: [modPaneTabId(pane('diff'))],
    asked: [],
    held: new Set(),
  })
  expect(plan.close).toEqual([modPaneTabId(pane('diff'))])
})

test('a tab the person is closing is not opened again until the mod has answered', () => {
  const diff = pane('diff')
  const held = new Set([modPaneTabId(diff)])
  expect(planPaneTabs({ panes: [diff], openTabs: [], asked: [], held }).open).toEqual([])
})
