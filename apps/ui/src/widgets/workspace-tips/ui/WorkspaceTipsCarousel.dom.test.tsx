import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

test('the tips carousel pages, ends by starting a chat, and remembers the last tip seen', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { WorkspaceTipsCarousel } = await import('./WorkspaceTipsCarousel')
  const view = (
    <MemoryRouter>
      <WorkspaceTipsCarousel />
    </MemoryRouter>
  )
  const { WORKSPACE_TIPS } = await import('./workspaceTips')
  const { useChatStore } = await import('@/features/chat/model/store')
  // The model slide reads live connections; the test has no server behind it.
  useChatStore.setState({ refreshConnections: async () => {}, loadProjects: async () => {} })
  localStorage.clear()

  const host = document.createElement('div')
  document.body.append(host)
  let root = createRoot(host)
  const title = () => host.querySelector('section')?.getAttribute('aria-label')
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!

  await act(async () => root.render(view))
  expect(title()).toBe(WORKSPACE_TIPS[0]!.lead)

  await act(async () => button('Previous').click())
  expect(title()).toBe(WORKSPACE_TIPS.at(-1)!.lead)
  // The last step ends the tour by starting a chat instead of looping on.
  const { subscribeChatChrome } = await import('@/shared/lib/chatChromeBus')
  const chrome: string[] = []
  const stop = subscribeChatChrome((event) => chrome.push(event))
  expect(button('Next')).toBeUndefined()
  await act(async () => button('Start chatting').click())
  expect(chrome).toEqual(['new-chat'])
  stop()

  await act(async () => button('Previous').click())
  await act(async () => button('Previous').click())
  expect(title()).toBe(WORKSPACE_TIPS.at(-3)!.lead)

  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(view))
  expect(title()).toBe(WORKSPACE_TIPS.at(-3)!.lead)

  await act(async () => root.unmount())
  host.remove()
})
