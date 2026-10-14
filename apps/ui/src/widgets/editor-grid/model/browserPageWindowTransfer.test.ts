import { afterEach, beforeEach, expect, test } from 'bun:test'
import { emptyEditorState, useGridStore, type WorkItem } from '@/features/workspace-grid/model'
import { useChatStore } from '@/features/chat/model/store'
import type { UiSession } from '@/shared/api/ui-session'
import { usePreviewStore, type PreviewEntry } from '@/features/inspector/model/previewStore'
import {
  configurePlatformCapabilities,
  type PlatformCapabilities,
} from '@/shared/lib/platformCapabilities'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'
import { browserTabTransferBus } from '@/shared/lib/browserTabTransferBus'
import { moveBrowserPageToWindow } from './browserPageWindowTransfer'
import {
  prepareTabTransfer,
  readTabTransferPayload,
  tabTransferStillCurrent,
  type TabTransferPayload,
} from './windowTransferPayload'

const grid = useGridStore.getState()
const chat = useChatStore.getState()
const previews = usePreviewStore.getState()
let restore: (() => void) | undefined
const browser: WorkItem = {
  id: 'preview:page-transfer@page-session',
  kind: 'preview',
  title: 'Browser',
  scope: 'page-session',
}
const entries: PreviewEntry[] = [
  { previewId: 'page-one', url: 'https://one.example/', title: 'One', version: 1 },
  { previewId: 'page-two', url: 'https://two.example/', title: 'Two', version: 1 },
]
beforeEach(() => {
  useGridStore.setState(emptyEditorState('source'))
  useChatStore.setState({
    activeProjectId: 'page-project',
    activeSessionId: 'page-session',
    sessions: [],
    allSessions: [{ id: 'page-session', projectId: 'page-project' } as UiSession],
  })
  useGridStore.getState().openItem(browser)
  usePreviewStore.setState({
    previewTabsBySession: { 'page-session': entries, 'other-session': [entries[1]!] },
    previewBySession: { 'page-session': entries[0]!, 'other-session': entries[1]! },
  })
})
afterEach(() => {
  restore?.()
  restore = undefined
  workItemTransferState.finish(browser.id)
  browserTabTransferBus.setPending('page-two', false)
  useGridStore.setState(grid)
  useChatStore.setState(chat)
  usePreviewStore.setState(previews)
})

function invoke(fn: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  restore = configurePlatformCapabilities({
    desktop: { invoke: fn as PlatformCapabilities['desktop']['invoke'] },
  })
}
const pages = () =>
  usePreviewStore.getState().previewTabsBySession['page-session']!.map((entry) => entry.previewId)

test('a single-page packet selects the dragged page even when a different page is active', () => {
  const { payload } = prepareTabTransfer(browser, 'page-two')
  expect(payload.browser).toEqual({
    sessionId: 'page-session',
    tabs: [entries[1]],
    activeId: 'page-two',
    pageId: 'page-two',
  })
  expect(readTabTransferPayload(payload)).toEqual(payload)
  expect(prepareTabTransfer(browser).payload.browser?.tabs).toEqual(entries)
})

test('only the selected page closes after ACK; source Browser and another conversation survive', async () => {
  let acknowledge!: (window: string) => void
  let payload!: TabTransferPayload
  invoke((command, args) => {
    expect(command).toBe('workspace_transfer_open')
    expect(args?.asTab).toBe(false)
    payload = args?.payload as TabTransferPayload
    return new Promise<string>((resolve) => {
      acknowledge = resolve
    })
  })
  const moving = moveBrowserPageToWindow(
    { sessionId: 'page-session', pageId: 'page-two' },
    'window',
  )
  expect(pages()).toEqual(['page-one', 'page-two'])
  expect(browserTabTransferBus.pending('page-two')).toBe(true)
  expect(payload.browser?.tabs.map((entry) => entry.previewId)).toEqual(['page-two'])
  acknowledge('destination')
  expect(await moving).toBe(true)
  expect(pages()).toEqual(['page-one'])
  expect(usePreviewStore.getState().previewTabsBySession['other-session']).toEqual([entries[1]])
  expect(useGridStore.getState().items[browser.id]).toBeDefined()
  expect(browserTabTransferBus.pending('page-two')).toBe(false)
})

test('a failed destination keeps all source pages and releases the pending state', async () => {
  invoke(async () => {
    throw new Error('Destination timed out')
  })
  expect(
    await moveBrowserPageToWindow({ sessionId: 'page-session', pageId: 'page-two' }, 'tab'),
  ).toBe(false)
  expect(pages()).toEqual(['page-one', 'page-two'])
  expect(workItemTransferState.pending(browser.id)).toBe(false)
  expect(browserTabTransferBus.pending('page-two')).toBe(false)
})

test('a new unrelated page and source tab switch do not cancel the selected-page move', async () => {
  let acknowledge!: (window: string) => void
  invoke(
    () =>
      new Promise<string>((resolve) => {
        acknowledge = resolve
      }),
  )
  const moving = moveBrowserPageToWindow({ sessionId: 'page-session', pageId: 'page-two' }, 'tab')
  usePreviewStore.getState().openBrowserTab('page-session', 'https://third.example/')
  const third = usePreviewStore.getState().previewTabsBySession['page-session']!.at(-1)!
  acknowledge('destination')
  expect(await moving).toBe(true)
  expect(pages()).toEqual(['page-one', third.previewId])
  expect(usePreviewStore.getState().previewBySession['page-session']?.previewId).toBe(
    third.previewId,
  )
})

test('navigation of the selected page during creation keeps its newer source state', async () => {
  let acknowledge!: (window: string) => void
  invoke(
    () =>
      new Promise<string>((resolve) => {
        acknowledge = resolve
      }),
  )
  const moving = moveBrowserPageToWindow(
    { sessionId: 'page-session', pageId: 'page-two' },
    'window',
  )
  usePreviewStore
    .getState()
    .updateBrowserTab('page-session', 'page-two', { url: 'https://two.example/new' })
  acknowledge('destination')
  expect(await moving).toBe(false)
  expect(pages()).toEqual(['page-one', 'page-two'])
  expect(usePreviewStore.getState().previewTabsBySession['page-session']![1]?.url).toBe(
    'https://two.example/new',
  )
})

test('placeholder and malformed single-page payloads cannot silently transfer the whole Browser', () => {
  expect(() => prepareTabTransfer(browser, 'browser:new-tab')).toThrow('no longer open')
  const { payload } = prepareTabTransfer(browser, 'page-two')
  expect(() =>
    readTabTransferPayload({ ...payload, browser: { ...payload.browser, tabs: entries } }),
  ).toThrow('Invalid transferred Browser page')
  const copy = { ...payload, browser: { ...payload.browser!, pageId: 'page-one' } }
  expect(tabTransferStillCurrent(copy, browser)).toBe(false)
})

test('another pending transfer cannot open a duplicate destination for this Browser', async () => {
  workItemTransferState.begin(browser.id)
  let calls = 0
  invoke(async () => {
    calls += 1
    return 'destination'
  })
  expect(
    await moveBrowserPageToWindow({ sessionId: 'page-session', pageId: 'page-two' }, 'window'),
  ).toBe(false)
  expect(calls).toBe(0)
})
