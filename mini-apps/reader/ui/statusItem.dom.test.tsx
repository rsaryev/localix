import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act, useEffect } from 'react'
import { registerDom } from '@localixai/kit/testing'
import type { StatusItemState } from '@localixai/mini-app-sdk/ui'
import {
  bindMiniAppUiRuntime,
  type MiniAppUiRuntime,
  type MiniAppWorkItemRequest,
} from '@localixai/mini-app-sdk/ui/runtime'

import { useReaderStatusItem } from './statusItem'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/**
 * The item is drawn per chat, and both Reader tab kinds are session kinds. Opened without a
 * session, the host had to guess one — and a book revealed from chat A's titlebar landed in
 * whichever chat was in front. These cases pin that every open names the item's own chat, and that
 * an item with no chat offers nothing rather than guessing.
 */
async function renderItem(sessionId: string | null) {
  const opened: MiniAppWorkItemRequest[] = []
  const snapshot = {
    items: { 'reader:book:a': { kind: 'reader:book', id: 'reader:book:a', title: 'Dune' } },
    focusedId: null,
  }
  const unbind = bindMiniAppUiRuntime({
    workspace: {
      openWorkItem: (request: MiniAppWorkItemRequest) => opened.push(request),
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
  } as unknown as MiniAppUiRuntime)
  let latest: StatusItemState | null = null
  function Probe() {
    const value = useReaderStatusItem(sessionId)
    // Read by the test once the commit is done, not written while rendering.
    useEffect(() => {
      latest = value
    })
    return null
  }
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Probe />))
  const cleanup = async () => {
    await act(async () => root.unmount())
    unbind()
  }
  return { item: () => latest as StatusItemState | null, opened, cleanup }
}

test('every open names the chat the item is drawn for', async () => {
  const { item, opened, cleanup } = await renderItem('chat-a')
  try {
    item()!.onClick?.()
    const library = item()!.menu?.find((entry) => 'id' in entry && entry.id === 'library')
    ;(library as { onSelect: () => void }).onSelect()
    expect(opened).toMatchObject([
      { workKind: 'reader:book', id: 'reader:book:a', scope: 'chat-a' },
      { workKind: 'reader:workspace', id: 'reader:workspace', scope: 'chat-a' },
    ])
  } finally {
    await cleanup()
  }
})

test('without a chat there is no item — nothing to guess a session for', async () => {
  const { item, cleanup } = await renderItem(null)
  try {
    expect(item()).toBeNull()
  } finally {
    await cleanup()
  }
})
