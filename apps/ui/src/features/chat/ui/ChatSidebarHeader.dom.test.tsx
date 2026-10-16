import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { ChatSidebarHeader } from './ChatSidebarHeader'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('history keeps workspace, search and view actions without a duplicate new-chat button', async () => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const search = mock(() => {})
  const folder = mock(() => {})
  const scope = mock(() => {})
  try {
    await act(async () =>
      root.render(
        <ChatSidebarHeader
          scopeName="Default"
          isGlobal
          onOpenScopeSwitcher={scope}
          onAddProjectFolder={folder}
          searchVisible={false}
          onToggleSearch={search}
          viewMenu={{
            groupingMode: 'activity',
            onGroupingModeChange: () => {},
            sortMode: 'recent',
            onSortModeChange: () => {},
            showArchived: false,
            onShowArchivedChange: () => {},
            archivedCount: 0,
          }}
        />,
      ),
    )
    expect(host.querySelector('[aria-label^="New chat"]')).toBeNull()
    expect(host.querySelector('[aria-label="New external session"]')).toBeNull()
    await act(async () => {
      host.querySelector<HTMLElement>('[aria-label="Search chats"]')!.click()
      host.querySelector<HTMLElement>('[aria-label="Add project folder"]')!.click()
      host.querySelector<HTMLElement>('[title="Switch workspace"]')!.click()
    })
    expect(search).toHaveBeenCalledTimes(1)
    expect(folder).toHaveBeenCalledTimes(1)
    expect(scope).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[aria-label="Conversation view options"]')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
