import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { usePreviewStore } from '../model/previewStore'
import { useBrowserHistory } from '../model/browserHistory'
import { BrowserWorkspace } from './BrowserWorkspace'
import { usePersonActions } from '../model/personActions'
import { liveTabMessageContext } from '@/entities/workspace-grid/model/liveTabMessageContext'
import { tabIdInScope } from '@/entities/workspace-grid/model'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

describe('BrowserWorkspace tabs', () => {
  test('history button opens a dedicated tab with visited pages', async () => {
    const { createRoot } = await import('react-dom/client')
    const previous = usePreviewStore.getState()
    const oldVisits = useBrowserHistory.getState().visits
    usePreviewStore.setState({ previewBySession: {}, previewTabsBySession: {} })
    useBrowserHistory.setState({
      visits: [{ url: 'https://example.com/', title: 'Example', visitedAt: Date.now() }],
    })
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<BrowserWorkspace sessionId="session-1" active={false} />))
      // With no tab open the strip still offers history, and the new tab lists recent pages.
      expect(container.querySelector('section h2')?.textContent).toBe('Recently visited')
      expect(container.querySelector('section')?.textContent).toContain('Example')
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Open browser history"]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(container.querySelector('[role="tab"]')?.textContent).toContain('History')
      // The History tab opened in THIS chat's Browser, nowhere else.
      expect(Object.keys(usePreviewStore.getState().previewTabsBySession)).toEqual(['session-1'])
      expect(container.querySelector('[aria-label="Search browser history"]')).not.toBeNull()
      // The day is said once above its pages; each page reads as its title over its address.
      expect(container.querySelector('section h2')?.textContent).toBe('Today')
      expect(container.querySelector('[data-slot="workbench-list-row-title"]')?.textContent).toBe(
        'Example',
      )
      expect(
        container.querySelector('[data-slot="workbench-list-row-description"]')?.textContent,
      ).toBe('example.com')
      expect(
        container.querySelector('button[aria-label="Remove Example from history"]'),
      ).not.toBeNull()
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Remove Example from history"]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(useBrowserHistory.getState().visits).toEqual([])
    } finally {
      await act(async () => root.unmount())
      usePreviewStore.setState({
        previewBySession: previous.previewBySession,
        previewTabsBySession: previous.previewTabsBySession,
      })
      useBrowserHistory.setState({ visits: oldVisits })
    }
  })

  test('exposes tab semantics and keeps keyboard selection and close actions in the store', async () => {
    const { createRoot } = await import('react-dom/client')
    const previous = usePreviewStore.getState()
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    )
    HTMLElement.prototype.scrollIntoView = () => {}

    const staging = {
      previewId: 'http://127.0.0.1:4173',
      url: 'http://127.0.0.1:4173/dashboard',
      title: 'Staging',
      version: 1,
    }
    const docs = {
      previewId: 'http://127.0.0.1:5173',
      url: 'http://127.0.0.1:5173/docs',
      title: 'Docs',
      version: 1,
    }
    // Another chat's page: it lives in that chat's strip and must never show in this Browser.
    const foreign = {
      previewId: 'http://127.0.0.1:6006',
      url: 'http://127.0.0.1:6006/',
      title: 'Other chat',
      version: 1,
    }
    usePreviewStore.setState({
      previewBySession: { 'session-1': staging, 'session-2': foreign },
      previewTabsBySession: { 'session-1': [staging, docs], 'session-2': [foreign] },
    })

    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<BrowserWorkspace sessionId="session-1" active={false} />))

      const tablist = container.querySelector<HTMLElement>('[role="tablist"]')
      expect(tablist?.getAttribute('aria-label')).toBe('Browser tabs')
      const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      expect(tabs.map((tab) => tab.textContent)).toEqual(['Staging', 'Docs'])
      expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
      expect(tabs[0]?.getAttribute('aria-controls')).toBeTruthy()

      await act(async () => {
        tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      })
      expect(usePreviewStore.getState().previewBySession['session-1']?.previewId).toBe(
        docs.previewId,
      )
      expect(usePreviewStore.getState().previewBySession['session-2']).toEqual(foreign)
      expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
        'Docs',
      )

      const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')
      expect(panel?.getAttribute('aria-labelledby')).toBeTruthy()
      expect(panel?.getAttribute('aria-labelledby')).toBe(
        container.querySelector('[role="tab"][aria-selected="true"]')?.id,
      )

      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Close Docs"]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(usePreviewStore.getState().previewTabsBySession['session-1']).toEqual([staging])
      expect(usePreviewStore.getState().previewBySession['session-1']).toEqual(staging)
      expect(usePreviewStore.getState().previewTabsBySession['session-2']).toEqual([foreign])
      expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      usePreviewStore.setState({
        previewBySession: previous.previewBySession,
        previewTabsBySession: previous.previewTabsBySession,
      })
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
      } else {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
      }
    }
  })
})

describe('BrowserWorkspace roster for the agent', () => {
  test('tells the agent a tab it opened was closed by the person', async () => {
    const { createRoot } = await import('react-dom/client')
    const previous = usePreviewStore.getState()
    const page = {
      previewId: 'tab-a',
      url: 'https://example.com/a',
      title: 'Example',
      version: 0,
      originSessionId: 'session-1',
      nativePage: true,
    }
    usePersonActions.setState({ bySession: {} })
    usePreviewStore.setState({
      previewBySession: { 'session-1': page },
      previewTabsBySession: { 'session-1': [page] },
    })
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<BrowserWorkspace sessionId="session-1" active={false} />))
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Close Example"]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      const published = JSON.stringify(
        liveTabMessageContext(tabIdInScope('preview', 'preview', 'session-1')),
      )
      expect(published).toContain(
        'The person closed tab tab-a (Example, https://example.com/a), which you opened.',
      )
    } finally {
      await act(async () => root.unmount())
      usePreviewStore.setState({
        previewBySession: previous.previewBySession,
        previewTabsBySession: previous.previewTabsBySession,
      })
      usePersonActions.setState({ bySession: {} })
    }
  })
})

describe('BrowserWorkspace — a framed page leaving for a sign-in provider', () => {
  test('the tab the person is using becomes the native page at that address', async () => {
    const { createRoot } = await import('react-dom/client')
    const { startPreviewFrameNavigation } = await import('../model/previewFrameNavigation')
    const previous = usePreviewStore.getState()
    const previousTauri = Object.getOwnPropertyDescriptor(window, '__TAURI__')
    const callbacks: Array<(event: { payload: unknown }) => void> = []
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: {
        event: {
          listen: (name: string, callback: (event: { payload: unknown }) => void) => {
            if (name === 'browser:frame-navigation') callbacks.push(callback)
            return Promise.resolve(() => {})
          },
        },
      },
    })
    // The live API says where the page is served from; the frame mounts once it has.
    const fetch = spyOn(globalThis, 'fetch').mockImplementation((async () =>
      Response.json({
        url: 'http://localhost:3000/',
        injectUrl: 'http://localhost:61001/',
      })) as unknown as typeof globalThis.fetch)
    const page = { previewId: 'tab-app', url: 'http://localhost:3000/', version: 1 }
    usePreviewStore.setState({
      previewBySession: { 'session-1': page },
      previewTabsBySession: { 'session-1': [page] },
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const stop = startPreviewFrameNavigation()
    try {
      await act(async () => root.render(<BrowserWorkspace sessionId="session-1" />))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const frame = container.querySelector('iframe')
      expect(frame).not.toBeNull()
      // The person clicked "Sign in" inside the page.
      frame!.focus()
      expect(document.activeElement).toBe(frame)
      const signIn = 'https://accounts.example.com/o/oauth2/auth?state=xyz'
      await act(async () => {
        for (const callback of callbacks) callback({ payload: { url: signIn } })
      })
      const tabs = usePreviewStore.getState().previewTabsBySession['session-1']
      expect(tabs).toHaveLength(1)
      expect(tabs?.[0]).toMatchObject({ previewId: 'tab-app', url: signIn, nativePage: true })
    } finally {
      stop()
      await act(async () => root.unmount())
      container.remove()
      fetch.mockRestore()
      if (previousTauri) Object.defineProperty(window, '__TAURI__', previousTauri)
      else delete (window as { __TAURI__?: unknown }).__TAURI__
      usePreviewStore.setState({
        previewBySession: previous.previewBySession,
        previewTabsBySession: previous.previewTabsBySession,
      })
    }
  })
})
