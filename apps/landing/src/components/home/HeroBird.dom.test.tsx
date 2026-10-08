import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

test('mobile wind pauses for visibility and reduced motion removes wind without removing the bird', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { HeroBird } = await import('./HeroBird')
  const originalMatchMedia = window.matchMedia
  const originalObserver = globalThis.IntersectionObserver
  const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden')
  const mediaListeners = new Set<() => void>()
  let reduced = false
  let hidden = false
  let notifyIntersection: ((visible: boolean) => void) | undefined
  let disconnected = false
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes('reduced-motion') && reduced
    },
    addEventListener: (_: string, listener: () => void) => {
      if (query.includes('reduced-motion')) mediaListeners.add(listener)
    },
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  })) as unknown as typeof window.matchMedia
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      notifyIntersection = (visible) =>
        callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as never)
    }
    observe() {}
    disconnect() {
      disconnected = true
    }
  } as unknown as typeof IntersectionObserver
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const wind = () => host.querySelectorAll('[style*="wind-sweep"]')
  const bird = () => host.querySelector<HTMLElement>('.hero-bird')!
  try {
    await act(async () => root.render(<HeroBird />))
    expect(host.querySelector('.hero-bird-logo')).not.toBeNull()
    expect(wind()).toHaveLength(8)
    expect(bird().dataset.paused).toBe('false')
    notifyIntersection!(false)
    expect(bird().dataset.paused).toBe('true')
    hidden = true
    notifyIntersection!(true)
    expect(bird().dataset.paused).toBe('true')
    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    expect(bird().dataset.paused).toBe('false')
    await act(async () => {
      reduced = true
      for (const listener of mediaListeners) listener()
    })
    expect(wind()).toHaveLength(0)
    expect(host.querySelector('.hero-bird-logo')).not.toBeNull()
    expect(disconnected).toBe(true)
    await act(async () => {
      reduced = false
      for (const listener of mediaListeners) listener()
    })
    expect(wind()).toHaveLength(8)
    expect(bird().dataset.paused).toBe('false')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    window.matchMedia = originalMatchMedia
    globalThis.IntersectionObserver = originalObserver
    if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor)
    else Reflect.deleteProperty(document, 'hidden')
  }
  expect(mediaListeners.size).toBe(0)
})
