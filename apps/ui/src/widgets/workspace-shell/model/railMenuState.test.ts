import { expect, test } from 'bun:test'
import { transitionRailMenu, type RailMenuState } from './railMenuState'

test('hover switches the open category and closes only the category it left', () => {
  const workspace = transitionRailMenu(null, { type: 'hover', id: 'workspace' })
  const tools = transitionRailMenu(workspace, { type: 'hover', id: 'tools' })
  expect(tools).toEqual({ id: 'tools', mode: 'hover', pressed: false })
  expect(transitionRailMenu(tools, { type: 'leave', id: 'workspace' })).toBe(tools)
  expect(transitionRailMenu(tools, { type: 'leave', id: 'tools' })).toBeNull()
})

test('pressing a hover preview makes it persist, including after switching categories', () => {
  let state: RailMenuState = transitionRailMenu(null, { type: 'hover', id: 'workspace' })
  state = transitionRailMenu(state, { type: 'press', id: 'workspace' })
  expect(state).toEqual({ id: 'workspace', mode: 'press', pressed: true })
  expect(transitionRailMenu(state, { type: 'leave', id: 'workspace' })).toBe(state)
  state = transitionRailMenu(state, { type: 'hover', id: 'tools' })
  expect(state).toEqual({ id: 'tools', mode: 'press', pressed: false })
  expect(transitionRailMenu(state, { type: 'leave', id: 'tools' })).toBe(state)
  state = transitionRailMenu(state, { type: 'press', id: 'tools' })
  expect(state).toEqual({ id: 'tools', mode: 'press', pressed: true })
  expect(transitionRailMenu(state, { type: 'press', id: 'tools' })).toBeNull()
})

test('a late dismissal from the old menu cannot close the new one', () => {
  const state: RailMenuState = { id: 'catalog', mode: 'press', pressed: true }
  expect(transitionRailMenu(state, { type: 'dismiss', id: 'workspace' })).toBe(state)
  expect(transitionRailMenu(state, { type: 'dismiss', id: 'catalog' })).toBeNull()
  expect(transitionRailMenu(state, { type: 'press', id: 'catalog', forceOpen: true })).toEqual(
    state,
  )
})
