import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'
import type { VfCommand } from '../protocol/index'

function makeDeps(): ActuateDeps {
  return {
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {},
  }
}

describe('scroll actuation', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('uses the viewport default and preserves horizontal, vertical, and zero amounts', async () => {
    const calls: ScrollToOptions[] = []
    const previousScroll = window.scrollBy
    window.scrollBy = (options?: ScrollToOptions | number) => {
      calls.push(options as ScrollToOptions)
    }
    try {
      const cases: [VfCommand['direction'], number | undefined, number, number][] = [
        [undefined, undefined, 0, Math.round(window.innerHeight * 0.8)],
        ['left', 30, -30, 0],
        ['right', 30, 30, 0],
        ['up', 30, 0, -30],
        ['down', 0, 0, 0],
      ]
      for (const [direction, amount, left, top] of cases) {
        const result = await runCommand({ action: 'scroll', direction, amount }, makeDeps())
        expect(result.ok).toBe(true)
        expect(calls.at(-1)).toEqual({ left, top, behavior: 'smooth' })
        expect(result.result?.note).toBe(`scrolled ${direction ?? 'down'} ${amount ?? top}px`)
      }
      expect(calls).toHaveLength(cases.length)
    } finally {
      window.scrollBy = previousScroll
    }
  })

  test('scrolls the panel container by its own height before settling and snapshotting', async () => {
    document.body.innerHTML =
      '<main><div style="overflow-y:auto"><button>Before</button></div></main>'
    const root = document.querySelector('main')!
    const scroller = root.firstElementChild!
    Object.defineProperties(scroller, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 1000 },
    })
    const order: string[] = []
    scroller.scrollBy = (options?: ScrollToOptions | number) => {
      expect(options).toEqual({ left: 0, top: 160, behavior: 'smooth' })
      order.push('scroll')
    }
    const deps = makeDeps()
    deps.root = root
    deps.settle = async () => {
      order.push('settle')
      scroller.querySelector('button')!.textContent = 'After'
    }
    const result = await runCommand({ action: 'scroll', snapshotAfter: true }, deps)
    expect(result.ok).toBe(true)
    expect(order).toEqual(['scroll', 'settle'])
    expect(result.result?.snapshot?.tree).toContain('After')
    expect(result.result?.snapshot?.tree).not.toContain('Before')
  })

  test('scrolls a healed target and forces fresh refs even without snapshotAfter', async () => {
    document.body.innerHTML = '<button id="old">Subscribe</button>'
    const deps = makeDeps()
    buildSnapshot(deps.reg)
    document.body.innerHTML = '<button>Subscribe</button>'
    const target = document.querySelector('button')!
    const calls: ScrollIntoViewOptions[] = []
    target.scrollIntoView = (options?: ScrollIntoViewOptions | boolean) => {
      calls.push(options as ScrollIntoViewOptions)
    }
    const result = await runCommand({ action: 'scroll', ref: 'e1' }, deps)
    expect(result.ok).toBe(true)
    expect(calls).toEqual([{ behavior: 'smooth', block: 'center' }])
    expect(result.result?.target).toContain('Subscribe')
    expect(result.result?.note).toContain('re-resolved')
    expect(result.result?.snapshot?.tree).toContain('[ref=')
  })

  test('returns invalid-selector failures without scrolling or settling', async () => {
    const deps = makeDeps()
    let settled = false
    deps.settle = async () => {
      settled = true
    }
    const result = await runCommand({ action: 'scroll', selector: '[' }, deps)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('bad_request')
    expect(result.result).toBeUndefined()
    expect(settled).toBe(false)
  })

  test('reads the current reduced-motion preference for each scroll', async () => {
    const previousMatchMedia = window.matchMedia
    const previousScroll = window.scrollBy
    const behaviors: (ScrollBehavior | undefined)[] = []
    let reduced = true
    window.matchMedia = (query) => {
      expect(query).toBe('(prefers-reduced-motion: reduce)')
      const result = previousMatchMedia.call(window, query)
      Object.defineProperty(result, 'matches', { value: reduced })
      return result
    }
    window.scrollBy = (options?: ScrollToOptions | number) => {
      behaviors.push((options as ScrollToOptions).behavior)
    }
    try {
      const deps = makeDeps()
      expect((await runCommand({ action: 'scroll', amount: 10 }, deps)).ok).toBe(true)
      reduced = false
      expect((await runCommand({ action: 'scroll', amount: 10 }, deps)).ok).toBe(true)
      expect(behaviors).toEqual(['auto', 'smooth'])
    } finally {
      window.matchMedia = previousMatchMedia
      window.scrollBy = previousScroll
    }
  })
})
