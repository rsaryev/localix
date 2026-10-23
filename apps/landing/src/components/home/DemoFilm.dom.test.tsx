import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

const realObserver = globalThis.IntersectionObserver
afterEach(() => {
  globalThis.IntersectionObserver = realObserver
})

/** An observer that reports every element on screen as soon as it is observed. */
function observeOnScreen() {
  globalThis.IntersectionObserver = class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
    }
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
}

async function mount(autoplay: boolean) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { DemoFilm } = await import('./DemoFilm')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<DemoFilm autoplay={autoplay} />))
  return {
    act,
    host,
    video: host.querySelector('video')!,
    toggle: host.querySelector<HTMLButtonElement>('.demo-toggle')!,
    async unmount() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

test('without autoplay the demo waits on its poster and loads on request, without player chrome', async () => {
  observeOnScreen()
  const view = await mount(false)
  try {
    expect(view.video.getAttribute('src')).toBeNull()
    expect(view.video.getAttribute('poster')).toBe('/films/demo.jpg')
    expect(view.video.hasAttribute('controls')).toBe(false)
    expect(view.host.querySelector('.demo-cover')?.textContent).toBe('Watch the demo')
    expect(view.toggle.getAttribute('aria-label')).toBe('Play demo')

    await view.act(async () => view.toggle.click())

    expect(view.video.getAttribute('src')).toBe('/films/demo.mp4')
    expect(view.video.hasAttribute('controls')).toBe(false)
    expect(view.video.loop).toBe(true)
    expect(view.host.querySelector('.demo-cover')?.textContent).toBe('Resume')
  } finally {
    await view.unmount()
  }
})

test('the demo loads itself once it is on screen, as the llx.sh terminal replays', async () => {
  observeOnScreen()
  const view = await mount(true)
  try {
    expect(view.video.getAttribute('src')).toBe('/films/demo.mp4')
    expect(view.video.muted).toBe(true)
    expect(view.video.hasAttribute('playsinline')).toBe(true)
  } finally {
    await view.unmount()
  }
})

test('off screen the demo loads nothing, even with autoplay', async () => {
  const view = await mount(true)
  try {
    expect(view.video.getAttribute('src')).toBeNull()
  } finally {
    await view.unmount()
  }
})
