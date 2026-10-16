import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { usePreviewStore } from '../model/previewStore'
import { useBrowserHistory } from '../model/browserHistory'
import { BrowserWorkspace } from './BrowserWorkspace'

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
