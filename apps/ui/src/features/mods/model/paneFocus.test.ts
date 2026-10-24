import { expect, test } from 'bun:test'
import type { ModPaneRef } from '@/shared/api/modsApi'
import { createPaneFocus } from './paneFocus'

const pane = (id: string, focusRequest: number): ModPaneRef => ({
  instance: 'blast-radius~1',
  plugin: 'blast-radius',
  id,
  cwd: null,
  closeOnEscape: false,
  focusRequest,
})

test('a pane asked forward is taken once; what was asked before the first read is not', () => {
  const focus = createPaneFocus()
  expect(focus.take([pane('old', 3)])).toEqual([])
  expect(focus.take([pane('old', 3), pane('held', 1)]).map((p) => p.id)).toEqual(['held'])
  expect(focus.requested()).toMatchObject({ id: 'held' })
  expect(focus.take([pane('old', 3), pane('held', 1)])).toEqual([])
  expect(focus.take([pane('old', 4), pane('held', 1)]).map((p) => p.id)).toEqual(['old'])
})
