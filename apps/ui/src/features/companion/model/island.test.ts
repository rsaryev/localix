import { expect, test } from 'bun:test'
import { reduceIsland, RESTING_ISLAND } from './island'

test('opens from the resting island and folds without resolving a request', () => {
  const opened = reduceIsland(RESTING_ISLAND, { type: 'toggle' })
  expect(opened).toEqual({ expanded: true, focusComposer: true, selectedKey: null, preview: false })
  const answering = reduceIsland(opened, { type: 'select', key: 'approval-1' })
  expect(reduceIsland(answering, { type: 'collapse' })).toEqual(RESTING_ISLAND)
  expect(answering.selectedKey).toBe('approval-1')
})

test('a late answer for another request cannot clear the current one', () => {
  const answering = reduceIsland(RESTING_ISLAND, { type: 'select', key: 'new-request' })
  expect(reduceIsland(answering, { type: 'resolved', key: 'old-request' })).toBe(answering)
  expect(reduceIsland(answering, { type: 'resolved', key: 'new-request' })).toEqual({
    expanded: true,
    focusComposer: true,
    selectedKey: null,
    preview: false,
  })
})

test('back shows the chat while retaining the expanded island', () => {
  const answering = reduceIsland(RESTING_ISLAND, { type: 'select', key: 'question' })
  expect(reduceIsland(answering, { type: 'back' })).toEqual({
    expanded: true,
    focusComposer: true,
    selectedKey: null,
    preview: false,
  })
})

test('hover focuses the input and cannot replace an active request', () => {
  expect(reduceIsland(RESTING_ISLAND, { type: 'hover' })).toEqual({
    expanded: true,
    focusComposer: true,
    selectedKey: null,
    preview: true,
  })
  const answering = reduceIsland(RESTING_ISLAND, { type: 'select', key: 'pending' })
  expect(reduceIsland(answering, { type: 'hover' })).toBe(answering)
})

test('a new HITL opens fully without focusing the composer', () => {
  const request = reduceIsland(RESTING_ISLAND, { type: 'select', key: 'approval' })
  expect(request.expanded).toBe(true)
  expect(request.selectedKey).toBe('approval')
  expect(request.focusComposer).toBe(false)
  const folded = reduceIsland(request, { type: 'collapse' })
  expect(folded.expanded).toBe(false)
  expect(reduceIsland(folded, { type: 'resolved', key: 'approval' })).toBe(folded)
})

test('typing or clicking turns a focused hover preview into a held conversation', () => {
  const preview = reduceIsland(RESTING_ISLAND, { type: 'hover' })
  const held = reduceIsland(preview, { type: 'interact' })
  expect(held.preview).toBe(false)
  expect(held.focusComposer).toBe(true)
  expect(reduceIsland(held, { type: 'interact' })).toBe(held)
  expect(reduceIsland(RESTING_ISLAND, { type: 'interact' })).toBe(RESTING_ISLAND)
})
