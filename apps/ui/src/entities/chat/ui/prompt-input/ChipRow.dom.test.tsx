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

test('the chip row fades the edge with more chips past it, and watches chips as they come', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ChipRow } = await import('./ChipRow')
  const observers: { callback: ResizeObserverCallback; observed: Element[] }[] = []
  const Original = globalThis.ResizeObserver
  globalThis.ResizeObserver = class implements ResizeObserver {
    private entry: { callback: ResizeObserverCallback; observed: Element[] }
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, observed: [] }
      observers.push(this.entry)
    }
    observe(target: Element) {
      this.entry.observed.push(target)
    }
    unobserve(target: Element) {
      this.entry.observed = this.entry.observed.filter((el) => el !== target)
    }
    disconnect() {
      this.entry.observed = []
    }
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const chips = (names: string[]) => names.map((name) => <span key={name}>{name}</span>)
  const row = () => host.firstElementChild as HTMLDivElement
  const metrics = (scrollLeft: number) => {
    Object.defineProperty(row(), 'scrollWidth', { configurable: true, value: 300 })
    Object.defineProperty(row(), 'clientWidth', { configurable: true, value: 100 })
    Object.defineProperty(row(), 'scrollLeft', { configurable: true, value: scrollLeft })
  }
  try {
    await act(async () => root.render(<ChipRow>{chips(['a', 'b', 'c'])}</ChipRow>))
    expect(row().style.maskImage).toBe('')

    metrics(0)
    await act(async () => observers.at(-1)!.callback([], {} as ResizeObserver))
    expect(row().style.maskImage).toContain('black calc(100% - 1.5rem), transparent)')

    metrics(200)
    await act(async () => void row().dispatchEvent(new Event('scroll')))
    expect(row().style.maskImage).toBe(
      'linear-gradient(to right, transparent, black 1.5rem, black calc(100% - 1.5rem), black)',
    )

    // A composer render with the same chips: the row is not observed again.
    const created = observers.length
    await act(async () => root.render(<ChipRow>{chips(['a', 'b', 'c'])}</ChipRow>))
    expect(observers.length).toBe(created)

    // A new chip is watched for size, a removed one no longer is.
    await act(async () => root.render(<ChipRow>{chips(['b', 'c', 'd'])}</ChipRow>))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
    const watched = observers.at(-1)!.observed.map((el) => el.textContent)
    expect(watched).toContain('d')
    expect(watched).not.toContain('a')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    globalThis.ResizeObserver = Original
  }
})
