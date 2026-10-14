import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/** Each item is 100px wide, laid out left to right in DOM order. */
const ITEM_PX = 100

interface AnimateCall {
  key: string | null
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
}

let calls: AnimateCall[] = []
let reduced = false
let restore: (() => void) | null = null

beforeEach(() => {
  calls = []
  reduced = false
  const proto = HTMLElement.prototype
  // Saved through an index-signature view, as `reveal.dom.test.tsx` does: it is only put back on
  // this same prototype, and the view keeps the capture off the typed method (`unbound-method`).
  const view = proto as unknown as Record<string, unknown>
  const originalRect = view.getBoundingClientRect
  const originalAnimate = view.animate
  const originalMatchMedia = window.matchMedia
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const index = this.hasAttribute('data-flip-key')
      ? [...this.parentElement!.children].indexOf(this)
      : 0
    return { left: index * ITEM_PX, right: (index + 1) * ITEM_PX, width: ITEM_PX } as DOMRect
  }
  proto.animate = function (this: HTMLElement, keyframes, options) {
    calls.push({
      key: this.getAttribute('data-flip-key'),
      keyframes: keyframes as Keyframe[],
      options: options as KeyframeAnimationOptions,
    })
    return { cancel() {}, onfinish: null } as unknown as Animation
  }
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: reduced,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia
  document.documentElement.style.setProperty('--dur-moderate', '260ms')
  document.documentElement.style.setProperty('--ease-soft', 'ease-out')
  restore = () => {
    view.getBoundingClientRect = originalRect
    view.animate = originalAnimate
    window.matchMedia = originalMatchMedia
    document.documentElement.style.removeProperty('--dur-moderate')
    document.documentElement.style.removeProperty('--ease-soft')
  }
})
afterEach(() => restore?.())

async function mount(keys: string[], scope = 's1') {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { useFlipReorder, FLIP_KEY_ATTR } = await import('./useFlipReorder')
  function List({ order, owner }: { order: string[]; owner: string }) {
    const ref = React.useRef<HTMLDivElement>(null)
    useFlipReorder(ref, order, owner)
    return React.createElement(
      'div',
      { ref },
      order.map((key) => React.createElement('span', { key, [FLIP_KEY_ATTR]: key }, key)),
    )
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(React.createElement(List, { order: keys, owner: scope })))
  return {
    update: async (next: string[], nextScope = scope) => {
      await act(async () =>
        root.render(React.createElement(List, { order: next, owner: nextScope })),
      )
    },
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const deltaOf = (call: AnimateCall) => call.keyframes[0]!.transform

describe('useFlipReorder', () => {
  test('does not animate on first mount', async () => {
    const list = await mount(['a', 'b', 'c'])
    try {
      expect(calls).toEqual([])
    } finally {
      await list.cleanup()
    }
  })

  test('plays each moved item from its old place to its new one with the motion tokens', async () => {
    const list = await mount(['a', 'b', 'c'])
    try {
      await list.update(['c', 'a', 'b'])
      const byKey = Object.fromEntries(calls.map((call) => [call.key, call]))
      // c moved from 200 to 0; a and b each moved one slot right.
      expect(deltaOf(byKey.c!)).toBe('translateX(200px)')
      expect(deltaOf(byKey.a!)).toBe('translateX(-100px)')
      expect(deltaOf(byKey.b!)).toBe('translateX(-100px)')
      expect(byKey.c!.keyframes[1]!.transform).toBe('none')
      expect(byKey.c!.options).toEqual({ duration: 260, easing: 'ease-out' })
    } finally {
      await list.cleanup()
    }
  })

  test('items that kept their place and new items are not animated', async () => {
    const list = await mount(['a', 'b'])
    try {
      await list.update(['a', 'b', 'x'])
      expect(calls).toEqual([])
    } finally {
      await list.cleanup()
    }
  })

  test('reduced motion reorders without animating', async () => {
    const list = await mount(['a', 'b', 'c'])
    try {
      reduced = true
      await list.update(['c', 'b', 'a'])
      expect(calls).toEqual([])
    } finally {
      await list.cleanup()
    }
  })

  test('no motion token means no animation rather than a literal duration', async () => {
    const list = await mount(['a', 'b'])
    try {
      document.documentElement.style.removeProperty('--dur-moderate')
      await list.update(['b', 'a'])
      expect(calls).toEqual([])
    } finally {
      await list.cleanup()
    }
  })

  test('a new scope starts over without motion', async () => {
    const list = await mount(['a', 'b'], 'first')
    try {
      await list.update(['b', 'a'], 'second')
      expect(calls).toEqual([])
      await list.update(['a', 'b'], 'second')
      expect(calls.map((call) => call.key ?? '').sort((a, b) => a.localeCompare(b))).toEqual([
        'a',
        'b',
      ])
    } finally {
      await list.cleanup()
    }
  })
})

describe('drawnTranslateX', () => {
  test('reads 2d and 3d matrices and treats none as zero', async () => {
    const { drawnTranslateX } = await import('./useFlipReorder')
    const element = document.createElement('div')
    document.body.appendChild(element)
    try {
      expect(drawnTranslateX(element)).toBe(0)
      element.style.transform = 'matrix(1, 0, 0, 1, 42, 0)'
      expect(drawnTranslateX(element)).toBe(42)
      element.style.transform = 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -7, 0, 0, 1)'
      expect(drawnTranslateX(element)).toBe(-7)
    } finally {
      element.remove()
    }
  })
})
