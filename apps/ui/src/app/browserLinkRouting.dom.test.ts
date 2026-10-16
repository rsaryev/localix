import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())

test('shared links open and reveal app tabs; explicit OS links and mail bypass the app', async () => {
  const { startBrowserLinkRouting } = await import('./browserLinkRouting')
  const { useChatStore } = await import('@/features/chat/model/store')
  const { usePreviewStore } = await import('@/features/inspector/model/previewStore')
  const { useBrowserHistory } = await import('@/features/inspector/model/browserHistory')
  const { registerInspectorHandler } = await import('@/shared/lib/inspectorBus')
  const { platformCapabilities } = await import('@/shared/lib/platformCapabilities')
  const { registerConfirmationHost, pendingConfirmation, decideConfirmation } =
    await import('@/shared/lib/confirmAction')
  const chat = useChatStore.getState()
  const previews = usePreviewStore.getState()
  const history = useBrowserHistory.getState()
  const originalOpen = window.open
  const requests: unknown[] = []
  const systemUrls: string[] = []
  window.open = ((url?: string | URL) => {
    systemUrls.push(String(url))
    return null
  }) as typeof window.open
  const stopInspector = registerInspectorHandler((request) => requests.push(request))
  const stopRouting = startBrowserLinkRouting()
  const stopConfirmation = registerConfirmationHost()
  try {
    useChatStore.setState({ activeSessionId: 'link-session' })
    usePreviewStore.setState({ previewBySession: {}, previewTabsBySession: {} })
    for (const url of ['https://example.com/docs', 'http://localhost:3000/']) {
      platformCapabilities().external.open(url)
      expect(pendingConfirmation()).toBeNull()
      expect(usePreviewStore.getState().previewBySession['link-session']).toMatchObject({
        url,
        nativePage: true,
      })
    }
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ kind: 'preview', sessionId: 'link-session' })
    expect(systemUrls).toEqual([])

    for (const url of ['https://example.com/oauth', 'mailto:hello@example.com']) {
      platformCapabilities().external.open(url, url.startsWith('https:'))
      expect(pendingConfirmation()).toMatchObject({ detail: url })
      decideConfirmation(true)
    }
    expect(requests).toHaveLength(2)
    expect(systemUrls).toEqual(['https://example.com/oauth', 'mailto:hello@example.com'])

    useChatStore.setState({ activeSessionId: null })
    platformCapabilities().external.open('https://example.com/setup')
    decideConfirmation(true)
    expect(systemUrls.at(-1)).toBe('https://example.com/setup')
  } finally {
    stopConfirmation()
    stopRouting()
    stopInspector()
    window.open = originalOpen
    useChatStore.setState(chat, true)
    usePreviewStore.setState(previews, true)
    useBrowserHistory.setState(history, true)
  }
})
