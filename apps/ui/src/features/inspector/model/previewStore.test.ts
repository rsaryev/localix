import { expect, test } from 'bun:test'
import { usePreviewStore } from './previewStore'

function withEmptyStore(run: () => void): void {
  const before = usePreviewStore.getState()
  try {
    usePreviewStore.setState({ previewBySession: {}, previewTabsBySession: {} })
    run()
  } finally {
    usePreviewStore.setState({
      previewBySession: before.previewBySession,
      previewTabsBySession: before.previewTabsBySession,
    })
  }
}

// The strip used to be ONE `@browser` roster rendered by every chat's Browser, so a page opened in
// chat A appeared in chat B's Browser and B's agent saw it in its tab roster.
test("a page opened in one chat never appears in another chat's Browser", () => {
  withEmptyStore(() => {
    const store = usePreviewStore.getState()
    store.recordPreview('chat-a', { previewId: 'tab-a', url: 'https://example.com/', version: 1 })
    store.openBrowserTab('chat-a', 'https://docs.example.com/')
    store.recordPreview('chat-b', { previewId: 'tab-b', url: 'https://example.org/', version: 1 })
    const { previewTabsBySession, previewBySession } = usePreviewStore.getState()
    expect(previewTabsBySession['chat-a']?.map((tab) => tab.url)).toEqual([
      'https://example.com/',
      'https://docs.example.com/',
    ])
    expect(previewTabsBySession['chat-b']).toMatchObject([
      { previewId: 'tab-b', originSessionId: 'chat-b' },
    ])
    expect(previewBySession['chat-b']?.previewId).toBe('tab-b')

    // Selecting, reordering and the History tab stay inside the chat that asked for them.
    store.setActivePreview('chat-b', 'tab-a')
    expect(usePreviewStore.getState().previewBySession['chat-b']?.previewId).toBe('tab-b')
    store.openBrowserHistory('chat-a')
    expect(usePreviewStore.getState().previewTabsBySession['chat-b']).toHaveLength(1)
  })
})

test("deleting a chat discards its strip and leaves the other chat's", () => {
  withEmptyStore(() => {
    const store = usePreviewStore.getState()
    store.recordPreview('chat-a', { previewId: 'tab-a', url: 'https://example.com/', version: 1 })
    store.recordPreview('chat-b', { previewId: 'tab-b', url: 'https://example.org/', version: 1 })
    store.discardSessionPreview('chat-a')
    const { previewTabsBySession, previewBySession } = usePreviewStore.getState()
    expect(previewTabsBySession['chat-a']).toBeUndefined()
    expect(previewBySession['chat-a']).toBeUndefined()
    expect(previewTabsBySession['chat-b']?.map((tab) => tab.previewId)).toEqual(['tab-b'])
  })
})

test('a tab id closes its own tab, in whichever chat holds it', () => {
  withEmptyStore(() => {
    const store = usePreviewStore.getState()
    store.recordPreview('chat-a', { previewId: 'tab-a', url: 'https://example.com/', version: 1 })
    store.recordPreview('chat-b', { previewId: 'tab-b', url: 'https://example.org/', version: 1 })
    store.closeBrowserTabs(['tab-b'])
    const { previewTabsBySession, previewBySession } = usePreviewStore.getState()
    expect(previewTabsBySession['chat-a']?.map((tab) => tab.previewId)).toEqual(['tab-a'])
    expect(previewTabsBySession['chat-b']).toEqual([])
    expect(previewBySession['chat-b']).toBeUndefined()
  })
})

test('reopening a tab in Responsive mode clears a previous fixed viewport', () => {
  withEmptyStore(() => {
    const store = usePreviewStore.getState()
    store.recordPreview('chat-a', {
      previewId: 'tab-a',
      url: 'http://localhost:5000/',
      version: 1,
      viewport: { width: 375, height: 667 },
    })
    store.recordPreview('chat-a', {
      previewId: 'tab-a',
      url: 'http://localhost:5000/',
      version: 2,
      viewport: null,
    })
    expect(usePreviewStore.getState().previewBySession['chat-a']?.viewport).toBeNull()
    expect(usePreviewStore.getState().previewTabsBySession['chat-a']?.[0]?.viewport).toBeNull()
  })
})

test('a dragged browser tab lands before its drop target, or last on the strip', () => {
  const tab = (previewId: string) => ({ previewId, url: `https://${previewId}.dev/`, version: 0 })
  withEmptyStore(() => {
    usePreviewStore.setState({
      previewTabsBySession: { 'chat-a': [tab('a'), tab('b'), tab('c')], 'chat-b': [tab('d')] },
    })
    const order = () =>
      usePreviewStore.getState().previewTabsBySession['chat-a']?.map((entry) => entry.previewId)
    usePreviewStore.getState().moveBrowserTab('chat-a', 'c', 'a')
    expect(order()).toEqual(['c', 'a', 'b'])
    usePreviewStore.getState().moveBrowserTab('chat-a', 'c', null)
    expect(order()).toEqual(['a', 'b', 'c'])
    usePreviewStore.getState().moveBrowserTab('chat-a', 'missing', 'a')
    expect(order()).toEqual(['a', 'b', 'c'])
    // Another chat's tab is not on this strip, so it cannot be dropped into it.
    usePreviewStore.getState().moveBrowserTab('chat-a', 'd', 'a')
    expect(order()).toEqual(['a', 'b', 'c'])
  })
})
