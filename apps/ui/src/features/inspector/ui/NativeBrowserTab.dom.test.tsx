import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test'
import { act, type ReactNode } from 'react'
import { useFocusStack } from '@localixai/plugin-sdk/ui/focus'
import { registerDom } from '@localixai/kit/testing/dom'
import { useBrowserHistory } from '../model/browserHistory'
import { CAPTURE_BUDGET_MS } from '../model/nativePageLayer'
import { NativeBrowserTab } from './NativeBrowserTab'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})
beforeEach(() => useFocusStack.getState().reset())

const TAB = { previewId: 'browser-1', url: 'https://openai.com/', version: 1 }
const PICTURE = { data: 'cGFnZQ==', mediaType: 'image/jpeg', width: 800, height: 600 }

type Invocation = { command: string; args?: Record<string, unknown> }

/** The desktop bridge as the page sees it, recording every native call. */
function fakeDesktop() {
  const calls: Invocation[] = []
  const captures: Array<(image: typeof PICTURE) => void> = []
  const desktopWindow = window as typeof window & { __TAURI__?: unknown }
  const previous = desktopWindow.__TAURI__
  desktopWindow.__TAURI__ = {
    core: {
      invoke: async (command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args })
        if (command === 'browser_placeholder') {
          return new Promise((resolve) => captures.push(resolve))
        }
        if (command === 'browser_navigation_state') return { canGoBack: false, canGoForward: false }
        return null
      },
    },
  }
  return {
    calls,
    /** Answer the oldest pending capture, as WebKit's snapshot handler would. */
    finishCapture: () => act(async () => captures.shift()?.(PICTURE)),
    /** The page's visibility as the native side last heard it. */
    pageVisible: () =>
      (
        calls.findLast(({ command }) => command === 'browser_bounds')?.args?.bounds as
          | { visible: boolean }
          | undefined
      )?.visible,
    restore: () => {
      if (previous) desktopWindow.__TAURI__ = previous
      else delete desktopWindow.__TAURI__
    },
  }
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

const setInputValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Happy DOM lays nothing out, so give the page's box the rectangle a real pane would, then tell
 * the page its window resized — the same path a pane drag reaches it by.
 */
async function layOutPageBox(host: HTMLElement): Promise<void> {
  const box = host.querySelector<HTMLElement>('[aria-label^="Browser page:"]')
  if (!box) throw new Error('Browser page box missing')
  const rect = { x: 10, y: 80, width: 800, height: 600, top: 80, left: 10, right: 810, bottom: 680 }
  box.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect })
  await act(async () => window.dispatchEvent(new Event('resize')))
}

async function mount(
  children: (tab: ReactNode) => ReactNode,
  onOpenElsewhere: (url: string) => void = () => {},
) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const tab = (
    <NativeBrowserTab sessionId="native-chat" tab={TAB} active onOpenElsewhere={onOpenElsewhere} />
  )
  await act(async () => root.render(children(tab)))
  await settle()
  await layOutPageBox(host)
  return {
    host,
    render: (next: (tab: ReactNode) => ReactNode) => act(async () => root.render(next(tab))),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

/** Deliver the capture, then let the WebView paint the picture it became. */
async function paintPicture(
  desktop: ReturnType<typeof fakeDesktop>,
  host: HTMLElement,
): Promise<HTMLImageElement | null> {
  await desktop.finishCapture()
  await settle()
  const picture = host.querySelector<HTMLImageElement>('[aria-label^="Browser page:"] img')
  await act(async () => picture?.dispatchEvent(new Event('load')))
  await act(() => new Promise((resolve) => setTimeout(resolve, 32)))
  return picture
}

test('the history list opens over a page that steps aside behind its picture', async () => {
  const oldVisits = useBrowserHistory.getState().visits
  useBrowserHistory.setState({
    visits: [{ url: 'https://example.com/', title: 'Example', visitedAt: 1 }],
  })
  const desktop = fakeDesktop()
  const view = await mount((tab) => tab)
  try {
    expect(desktop.calls[0]).toEqual({
      command: 'browser_open',
      args: { tabId: 'browser-1', url: 'https://openai.com/' },
    })
    expect(desktop.pageVisible()).toBe(true)

    const address = view.host.querySelector<HTMLInputElement>('[aria-label="Browser address"]')
    await act(async () => address?.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
    expect(address?.getAttribute('aria-expanded')).toBe('true')
    // Still live: the page hides only once its picture is on screen.
    expect(desktop.pageVisible()).toBe(true)
    expect(desktop.calls.some(({ command }) => command === 'browser_placeholder')).toBe(true)

    const picture = await paintPicture(desktop, view.host)
    expect(picture?.getAttribute('src')).toBe('data:image/jpeg;base64,cGFnZQ==')
    expect(desktop.pageVisible()).toBe(false)
    // Paused: the picture takes on the app's ground, and the list over it is the opaque panel.
    expect(view.host.querySelector('[data-paused]')).not.toBeNull()
    expect(document.body.querySelector('[data-slot="autocomplete-list"]')?.className).toContain(
      'bg-background-solid',
    )

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[data-slot="autocomplete-option"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()
    expect(desktop.calls).toContainEqual({
      command: 'browser_navigate',
      args: { tabId: 'browser-1', url: 'https://example.com/' },
    })
    expect(desktop.pageVisible()).toBe(true)
    expect(view.host.querySelector('[data-paused]')).toBeNull()
  } finally {
    await view.unmount()
    desktop.restore()
    useBrowserHistory.setState({ visits: oldVisits })
  }
})

test('a dialog opens over the page; a closed one, however long it stays mounted, never does', async () => {
  const { Dialog, DialogContent, DialogTitle } = await import('@localixai/kit/dialog')
  const withDialog = (open: boolean) => (tab: ReactNode) => (
    <>
      {tab}
      <Dialog open={open}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Choose a model</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  )
  const desktop = fakeDesktop()
  // A picker mounted once stays mounted closed; that must read as no overlay at all.
  const view = await mount(withDialog(false))
  try {
    expect(desktop.pageVisible()).toBe(true)

    await view.render(withDialog(true))
    await paintPicture(desktop, view.host)
    expect(desktop.pageVisible()).toBe(false)

    await view.render(withDialog(false))
    await settle()
    expect(desktop.pageVisible()).toBe(true)
  } finally {
    await view.unmount()
    desktop.restore()
  }
})

test('without a picture the page still steps aside within the capture budget', async () => {
  const { Dialog, DialogContent, DialogTitle } = await import('@localixai/kit/dialog')
  const desktop = fakeDesktop()
  const view = await mount((tab) => tab)
  try {
    await view.render((tab) => (
      <>
        {tab}
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Settings</DialogTitle>
          </DialogContent>
        </Dialog>
      </>
    ))
    // The capture never answers: the budget alone decides.
    await act(() => new Promise((resolve) => setTimeout(resolve, CAPTURE_BUDGET_MS + 20)))
    expect(desktop.pageVisible()).toBe(false)
  } finally {
    await view.unmount()
    desktop.restore()
  }
})

test('an external page gets every page tool its engine can run, and only Visual Feedback is missing', async () => {
  const desktop = fakeDesktop()
  const view = await mount((tab) => tab)
  try {
    const labels = Array.from(view.host.querySelectorAll('button[aria-label]')).map((button) =>
      button.getAttribute('aria-label'),
    )
    for (const tool of [
      'Go back',
      'Go forward',
      'Reload page',
      'Page frame size',
      'Dev-server ports',
      'Open in browser',
    ]) {
      expect(labels).toContain(tool)
    }
    expect(labels).not.toContain('Visual Feedback')
  } finally {
    await view.unmount()
    desktop.restore()
  }
})

test('a local address typed into a native page opens as a dev preview instead', async () => {
  const desktop = fakeDesktop()
  const opened: string[] = []
  const view = await mount(
    (tab) => tab,
    (url) => opened.push(url),
  )
  try {
    const address = view.host.querySelector<HTMLInputElement>('[aria-label="Browser address"]')!
    await act(async () => setInputValue(address, 'http://localhost:5173'))
    await act(async () => {
      address.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(opened).toEqual(['http://localhost:5173/'])
    expect(desktop.calls.some(({ command }) => command === 'browser_navigate')).toBe(false)
  } finally {
    await view.unmount()
    desktop.restore()
  }
})
