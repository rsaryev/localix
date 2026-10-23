import { afterEach, expect, spyOn, test } from 'bun:test'
import type { CommentActionContribution } from '@localixai/mini-app-sdk/ui'

import { commentActions, registerCommentAction, removeCommentActionsOf } from './commentActions'
import { setEnabledMiniAppNames } from './miniAppActivation'

const Icon = () => null

function action(pluginName: string, id: string): CommentActionContribution {
  return { id: `${pluginName}:${id}`, label: id, Icon, pluginName, run: async () => {} }
}

afterEach(() => {
  removeCommentActionsOf('zeta-fixture')
  removeCommentActionsOf('alpha-fixture')
  setEnabledMiniAppNames(null)
})

test('the row is ordered by identity, not by load order', () => {
  // MUTATION: return the map in insertion order → red (zeta registered first).
  setEnabledMiniAppNames(new Set(['zeta-fixture', 'alpha-fixture']))
  registerCommentAction(action('zeta-fixture', 'issue'))
  registerCommentAction(action('alpha-fixture', 'task'))
  expect(commentActions().map((entry) => entry.id)).toEqual([
    'alpha-fixture:task',
    'zeta-fixture:issue',
  ])
  // Stable between registrations, so `useSyncExternalStore` does not loop on a fresh array.
  expect(commentActions()).toBe(commentActions())
})

test('a disabled plugin offers nothing, and re-enabling it brings the action back', () => {
  // MUTATION: drop the activation filter → red.
  setEnabledMiniAppNames(new Set())
  registerCommentAction(action('alpha-fixture', 'task'))
  expect(commentActions()).toEqual([])
  setEnabledMiniAppNames(new Set(['alpha-fixture']))
  expect(commentActions().map((entry) => entry.id)).toEqual(['alpha-fixture:task'])
})

test('a second owner of an id is refused', () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    setEnabledMiniAppNames(new Set(['alpha-fixture', 'zeta-fixture']))
    const first = action('alpha-fixture', 'task')
    registerCommentAction(first)
    registerCommentAction({ ...action('zeta-fixture', 'task'), id: first.id })
    expect(commentActions()).toEqual([first])
  } finally {
    warn.mockRestore()
  }
})
