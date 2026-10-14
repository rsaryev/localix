import { afterEach, beforeEach, expect, test } from 'bun:test'
import { emptyEditorState, useGridStore, type WorkItem } from '@/features/workspace-grid/model'
import { usePreviewStore } from '@/features/inspector/model/previewStore'
import { installBrowserPageOwnership } from './browserPageOwnership'

const grid = useGridStore.getState()
const previews = usePreviewStore.getState()
let stop: () => void
let closed: string[][]
const browser: WorkItem = { id: 'browser-a', kind: 'preview', scope: 'chat-a', title: 'Browser' }
const page = (id: string) => ({ previewId: id, url: `https://${id}.example/`, version: 1 })
beforeEach(() => {
  useGridStore.setState({ ...emptyEditorState('root'), items: { [browser.id]: browser } })
  usePreviewStore.setState({
    previewTabsBySession: { 'chat-a': [page('a')], 'chat-b': [page('b')] },
    previewBySession: { 'chat-a': page('a'), 'chat-b': page('b') },
  })
  closed = []
  stop = installBrowserPageOwnership((ids) => {
    closed.push([...ids])
  })
})
afterEach(() => {
  stop()
  useGridStore.setState(grid)
  usePreviewStore.setState(previews)
})

test('removing the logical Browser closes its native pages and retains the roster for reopening', () => {
  useGridStore.setState({ items: {} })
  expect(closed).toEqual([['a']])
  expect(usePreviewStore.getState().previewTabsBySession['chat-a']).toEqual([page('a')])
})

test('visibility, activation and warm body eviction do not close logically open pages', () => {
  useGridStore.setState({ maximizedGroup: 'other', activeGroup: 'other' })
  useGridStore.setState({ items: { [browser.id]: { ...browser, title: 'New title' } } })
  usePreviewStore.setState({ previewBySession: { 'chat-b': page('b') } })
  expect(closed).toEqual([])
})

test('another Browser owner keeps the workspace native pages alive', () => {
  useGridStore.setState({ items: { 'browser-other': { ...browser, id: 'browser-other' } } })
  expect(closed).toEqual([])
  useGridStore.setState({ items: {} })
  expect(closed).toEqual([['a']])
})

test('page and session removals close only removed native identities', () => {
  usePreviewStore.setState({ previewTabsBySession: { 'chat-b': [page('b')] } })
  expect(closed).toEqual([['a']])
  usePreviewStore.setState({ previewTabsBySession: {} })
  expect(closed).toEqual([['a'], ['b']])
})

test('reordering a strip and removing a duplicate reference keep its native page', () => {
  usePreviewStore.setState({ previewTabsBySession: { 'chat-b': [page('a'), page('b')] } })
  usePreviewStore.setState({ previewTabsBySession: { 'chat-b': [page('b'), page('a')] } })
  expect(closed).toEqual([])
})

test('disposal stops ownership observation without closing current Browser pages', () => {
  stop()
  useGridStore.setState({ items: {} })
  usePreviewStore.setState({ previewTabsBySession: {} })
  expect(closed).toEqual([])
})
