import { describe, expect, test } from 'bun:test'
import { clamp01, scrollPercent, percentToScrollTop, createScrollSyncGuard } from './scroll-sync'

describe('clamp01', () => {
  test('clamps into [0,1]', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(0)).toBe(0)
    expect(clamp01(0.42)).toBe(0.42)
    expect(clamp01(1)).toBe(1)
    expect(clamp01(2)).toBe(1)
  })
})

describe('scrollPercent', () => {
  test('top is 0, bottom is 1', () => {
    expect(scrollPercent({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 })).toBe(0)
    expect(scrollPercent({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })).toBe(1)
  })
  test('midpoint is 0.5', () => {
    expect(scrollPercent({ scrollTop: 400, scrollHeight: 1000, clientHeight: 200 })).toBe(0.5)
  })
  test('a non-overflowing pane is 0 (nothing to scroll)', () => {
    expect(scrollPercent({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 })).toBe(0)
    expect(scrollPercent({ scrollTop: 0, scrollHeight: 100, clientHeight: 200 })).toBe(0)
  })
  test('clamps an over-scroll (rubber-banding) to 1', () => {
    expect(scrollPercent({ scrollTop: 999, scrollHeight: 1000, clientHeight: 200 })).toBe(1)
  })
})

describe('percentToScrollTop', () => {
  test('maps a percentage back to scrollTop over the scrollable range', () => {
    expect(percentToScrollTop(0, { scrollHeight: 1000, clientHeight: 200 })).toBe(0)
    expect(percentToScrollTop(0.5, { scrollHeight: 1000, clientHeight: 200 })).toBe(400)
    expect(percentToScrollTop(1, { scrollHeight: 1000, clientHeight: 200 })).toBe(800)
  })
  test('round-trips with scrollPercent', () => {
    const geo = { scrollTop: 640, scrollHeight: 2000, clientHeight: 400 }
    const p = scrollPercent(geo)
    expect(percentToScrollTop(p, geo)).toBe(640)
  })
  test('a non-overflowing pane maps everything to 0', () => {
    expect(percentToScrollTop(0.5, { scrollHeight: 200, clientHeight: 200 })).toBe(0)
  })
  test('clamps an out-of-range percentage', () => {
    expect(percentToScrollTop(2, { scrollHeight: 1000, clientHeight: 200 })).toBe(800)
    expect(percentToScrollTop(-1, { scrollHeight: 1000, clientHeight: 200 })).toBe(0)
  })
})

describe('createScrollSyncGuard', () => {
  test('keeps the Window receiver for the default animation-frame host', () => {
    const original = globalThis.requestAnimationFrame
    let callbacks = 0
    globalThis.requestAnimationFrame = function (
      this: typeof globalThis,
      callback: FrameRequestCallback,
    ): number {
      expect(this).toBe(globalThis)
      callbacks += 1
      callback(0)
      return 1
    }
    try {
      const guard = createScrollSyncGuard()
      guard.guard(() => {
        expect(guard.isGuarded()).toBe(true)
      })
      expect(callbacks).toBe(1)
      expect(guard.isGuarded()).toBe(false)
    } finally {
      // Assigning `undefined` back would leave the key behind for every later file.
      if (original) globalThis.requestAnimationFrame = original
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    }
  })

  test('is guarded during the apply and released on the next frame', () => {
    let pending: (() => void) | null = null
    const raf = (cb: () => void) => {
      pending = cb
    }
    const guard = createScrollSyncGuard(raf)
    expect(guard.isGuarded()).toBe(false)

    let observedDuringApply = false
    guard.guard(() => {
      // A programmatic scroll fires the handler synchronously — it must see the guard.
      observedDuringApply = guard.isGuarded()
    })
    expect(observedDuringApply).toBe(true)
    // Still guarded until the frame callback runs (a late synthetic scroll event
    // within the same frame is also swallowed).
    expect(guard.isGuarded()).toBe(true)

    pending!() // next animation frame
    expect(guard.isGuarded()).toBe(false)
  })

  test('a scroll handler that checks isGuarded skips the echo while guarded', () => {
    let pending: (() => void) | null = null
    const raf = (cb: () => void) => {
      pending = cb
    }
    const guard = createScrollSyncGuard(raf)
    let echoes = 0
    const onScroll = () => {
      if (!guard.isGuarded()) echoes++
    }

    guard.guard(() => {
      onScroll()
    }) // synthetic scroll from the programmatic apply
    expect(echoes).toBe(0) // swallowed — no feedback

    pending!()
    onScroll() // a real user scroll after release
    expect(echoes).toBe(1)
  })
})
