import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'

import { registerDom } from '@localixai/kit/testing/dom'
import { adopt, tap } from '@/testing/hookProbe'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

/**
 * THE BUTTON AND THE FOLLOW STATE MUST COME FROM ONE PREDICATE, AND THAT PREDICATE MUST KNOW THAT A
 * VIEWPORT WHICH CANNOT SCROLL IS ALREADY AT THE BOTTOM.
 *
 * Reported symptom: "the button shows when it isn't needed", and "the chat should always open at the
 * end". Both come from the same place — `showScrollToBottom` was written from FIVE independent sites
 * (restore, sync, user-intent unpin, scroll handler, scrollToBottom) and one of them (the
 * restored-unpinned branch) set it to `true` BEFORE measuring anything, so a short session that had
 * been left scrolled up opened with a button pointing at nothing.
 *
 * The guard itself: a non-overflowing viewport IS at-bottom, so the visibility computation must
 * open with `if (scrollHeight <= clientHeight) { hide; return }` before any threshold math.
 *
 * The second half is the open/switch case: opening or switching a session goes to the live tail
 * rather than restoring a saved offset. Ours restored `follow:false` on open, which is the reported
 * "doesn't open at the end".
 */

interface Geometry {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
}

/** A scroll container with controllable geometry — jsdom gives every element 0 height. */
function viewport(geometry: Geometry): HTMLDivElement {
  const node = document.createElement('div')
  const child = document.createElement('div')
  node.appendChild(child)
  Object.defineProperty(node, 'scrollHeight', { value: geometry.scrollHeight, writable: true })
  Object.defineProperty(node, 'clientHeight', { value: geometry.clientHeight, writable: true })
  let top = geometry.scrollTop
  Object.defineProperty(node, 'scrollTop', {
    get: () => top,
    set: (next: number) => {
      top = next
    },
  })
  node.scrollTo = ((options: ScrollToOptions) => {
    top = options.top ?? top
    node.dispatchEvent(new Event('scroll'))
  }) as HTMLElement['scrollTo']
  document.body.appendChild(node)
  return node
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('atBottom — the one predicate behind both the button and following', () => {
  test('a viewport that cannot scroll is at the bottom, whatever scrollTop says', async () => {
    const { atBottom } = await import('./useAutoScroll')
    // The reported case: a short session. Nothing to scroll ⇒ no button, ever.
    expect(atBottom({ scrollHeight: 300, clientHeight: 300, scrollTop: 0 })).toBe(true)
    expect(atBottom({ scrollHeight: 120, clientHeight: 900, scrollTop: 0 })).toBe(true)
    // Exactly one pixel of overflow is not scrollable in practice (browsers round).
    expect(atBottom({ scrollHeight: 901, clientHeight: 900, scrollTop: 0 })).toBe(true)
    // AT A TIGHT THRESHOLD the clause is the only thing answering. With the default 80px band the
    // arithmetic happens to agree (non-overflow can never be more than 1px from the bottom), so a
    // test that only used the default would pass with the clause deleted — measured, not assumed.
    // The references run thresholds of ~1px, which is exactly this regime.
    expect(atBottom({ scrollHeight: 300, clientHeight: 300, scrollTop: 0 }, 0)).toBe(true)
    expect(atBottom({ scrollHeight: 901, clientHeight: 900, scrollTop: 0 }, 0)).toBe(true)
  })

  test('a scrollable viewport away from the tail is NOT at the bottom', async () => {
    const { atBottom } = await import('./useAutoScroll')
    expect(atBottom({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })).toBe(false)
    // Inside the near-bottom band still counts as following.
    expect(atBottom({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 1_460 })).toBe(true)
    expect(atBottom({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 1_400 })).toBe(false)
  })
})

describe('the scroll-to-bottom button', () => {
  test('stays hidden after restoring an unpinned session that no longer overflows', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { saveChatScrollSnapshot, clearChatScrollSnapshotsForTests } =
      await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    // The session was left scrolled up — while it was long enough to scroll.
    saveChatScrollSnapshot('s1', { scrollTop: 900, follow: false })

    // It now fits on one screen (branch switch, cleared history, a collapsed tool card).
    const node = viewport({ scrollHeight: 300, clientHeight: 300, scrollTop: 0 })
    const shown = tap<boolean>()
    function Probe() {
      const { scrollRef, showScrollToBottom } = useAutoScroll<HTMLDivElement>('s1')
      shown.put(showScrollToBottom)
      // Assigned during RENDER, not in an effect: the hook's own effects (restore, listeners) run
      // before a child effect would, and with a null ref they no-op — which made the first version
      // of this test pass without exercising the restore path at all.
      adopt(scrollRef, node)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => {
        await Promise.resolve()
      })
      expect(shown.value, 'nothing to scroll to — the button must not appear').toBe(false)
    } finally {
      await act(async () => root.unmount())
    }
  })
})

describe('the warm-tab case the open policy must NOT break', () => {
  test('re-applies the tail after the virtual transcript publishes its measured height', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    let openingFrame: FrameRequestCallback | null = null
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      openingFrame = callback
      return 1
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {
      openingFrame = null
    }) as typeof cancelAnimationFrame
    const node = viewport({ scrollHeight: 600, clientHeight: 500, scrollTop: 0 })
    function Probe() {
      const { scrollRef } = useAutoScroll<HTMLDivElement>('late-measurement')
      adopt(scrollRef, node)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      expect(node.scrollTop).toBe(100)

      // TanStack Virtual measures rows after the parent open effect. No viewport
      // resize is required, so relying on ResizeObserver alone misses this case.
      ;(node as unknown as { scrollHeight: number }).scrollHeight = 2_000
      await act(async () => openingFrame?.(performance.now()))
      expect(node.scrollTop).toBe(1_500)
    } finally {
      await act(async () => root.unmount())
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })

  test('the same session losing and regaining geometry restores its reading position', async () => {
    // A chat kept mounted while hidden: clientHeight goes to 0 and back. The reader never left, so
    // their offset must survive — this is the case the snapshot exists for, and the open-at-bottom
    // intent must not swallow it (it is consumed by the OPEN, once).
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })
    function Probe() {
      const { scrollRef } = useAutoScroll<HTMLDivElement>('s3')
      adopt(scrollRef, node)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => {
        await Promise.resolve()
      })
      // Opened at the tail (the new policy), then the reader scrolls up and stays there.
      expect(node.scrollTop).toBe(1_500)
      await act(async () => {
        node.scrollTop = 400
        node.dispatchEvent(new Event('wheel'))
        node.dispatchEvent(new Event('scroll'))
      })
      expect(node.scrollTop, 'a user scroll-up must not be yanked back').toBe(400)
    } finally {
      await act(async () => root.unmount())
    }
  })
})

describe('the restored-unpinned hold', () => {
  test('is not armed when the REGAINED viewport cannot scroll', async () => {
    // The one path the open-at-bottom intent does not cover: the SAME session's viewport losing and
    // regaining geometry (a warm tab hidden, then shown). Driven through a stubbed ResizeObserver,
    // because that transition is what calls `restore()` — without it this branch is unreachable and
    // the guard inside it would be untestable dead weight.
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const OriginalResizeObserver = globalThis.ResizeObserver
    const callbacks: ResizeObserverCallback[] = []
    class CapturingResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        callbacks.push(cb)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver

    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 700 })
    const shown = tap<boolean>()
    function Probe() {
      const { scrollRef, showScrollToBottom } = useAutoScroll<HTMLDivElement>('s5')
      shown.put(showScrollToBottom)
      adopt(scrollRef, node)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => {
        await Promise.resolve()
      })
      // The reader scrolls up AFTER the open — that is what writes a `follow:false` snapshot. Saving
      // one before mount does not work: the open intent consumes (and clears) it, so the restore path
      // would never run and this test would pass without exercising the branch at all.
      await act(async () => {
        node.scrollTop = 700
        node.dispatchEvent(new Event('wheel'))
        node.dispatchEvent(new Event('scroll'))
      })
      expect(shown.value, 'scrolled up in a long session — the button belongs here').toBe(true)

      const fire = async () => {
        await act(async () => {
          for (const cb of callbacks) cb([], {} as ResizeObserver)
        })
      }
      // Hidden: geometry goes to zero (this saves the position and marks a restore pending).
      Object.defineProperty(node, 'clientHeight', { value: 0, writable: true })
      await fire()
      // Shown again — but the content now fits on one screen.
      Object.defineProperty(node, 'scrollHeight', { value: 300, writable: true })
      Object.defineProperty(node, 'clientHeight', { value: 300, writable: true })
      await fire()

      expect(shown.value, 'the regained viewport cannot scroll — no button').toBe(false)
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver
      await act(async () => root.unmount())
    }
  })

  test('does not show the button when a collapsed transcript stops overflowing', async () => {
    // The hold exists so a restored reading position is not instantly re-pinned by streaming growth.
    // It must still lose to geometry: a warm tab that regains a viewport too short to scroll has
    // nowhere to go. This is the path the OPEN intent does not cover (same session, no switch).
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })
    const shown = tap<boolean>()
    function Probe() {
      const { scrollRef, showScrollToBottom } = useAutoScroll<HTMLDivElement>('s4')
      shown.put(showScrollToBottom)
      adopt(scrollRef, node)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => {
        await Promise.resolve()
      })
      // Reader scrolls up (unpins + saves follow:false), then the content collapses to one screen.
      await act(async () => {
        node.scrollTop = 200
        node.dispatchEvent(new Event('wheel'))
        node.dispatchEvent(new Event('scroll'))
      })
      expect(shown.value, 'scrolled up in a long session — the button belongs here').toBe(true)

      await act(async () => {
        Object.defineProperty(node, 'scrollHeight', { value: 300, writable: true })
        Object.defineProperty(node, 'clientHeight', { value: 300, writable: true })
        node.dispatchEvent(new Event('scroll'))
      })
      expect(shown.value, 'nothing left to scroll — the button must go away').toBe(false)
    } finally {
      await act(async () => root.unmount())
    }
  })
})

describe('scrollToBottom vs forceScrollToBottom', () => {
  test('the non-forcing call leaves a reader who scrolled up exactly where they are', async () => {
    /**
     * The two differed in NAME only: `scrollToBottom` set `shouldStickToBottom = true` on its first
     * line, so it re-pinned just as hard as the "force" variant, and the doc-comment on
     * `forceScrollToBottom` ("regardless of current stick state") described a distinction that did not
     * exist. The one caller that needs the difference is the HITL arrival trigger — and the HITL prompt
     * renders as `interactionOverlay` INSIDE the composer (`PromptInput`), so it is on screen at every
     * scroll position. Scrolling the transcript for it buys no visibility and costs the reader their
     * place in history.
     */
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })
    const api = tap<{
      scrollToBottom: (behavior?: ScrollBehavior) => void
      forceScrollToBottom: (behavior?: ScrollBehavior) => void
    }>()
    function Probe() {
      const hook = useAutoScroll<HTMLDivElement>('s6')
      adopt(hook.scrollRef, node)
      api.put({
        scrollToBottom: hook.scrollToBottom,
        forceScrollToBottom: hook.forceScrollToBottom,
      })
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => {
        await Promise.resolve()
      })
      // Deliberately up in history.
      await act(async () => {
        node.scrollTop = 300
        node.dispatchEvent(new Event('wheel'))
        node.dispatchEvent(new Event('scroll'))
      })
      expect(node.scrollTop).toBe(300)

      // A HITL question arrives. The overlay is already visible; the transcript must not move.
      await act(async () => {
        api.value!.scrollToBottom('smooth')
      })
      expect(node.scrollTop, 'an unpinned reader must not be yanked to the tail').toBe(300)

      // The explicit paths still work: the button, and the user sending a message.
      await act(async () => {
        api.value!.forceScrollToBottom('auto')
      })
      expect(node.scrollTop, 'force must always land on the tail').toBe(1_500)
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('a quick smooth jump clears stale wheel intent and resumes stream follow', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })
    const api = tap<ReturnType<typeof useAutoScroll<HTMLDivElement>>>()
    const shown = tap<boolean>()
    function Probe() {
      const hook = useAutoScroll<HTMLDivElement>('smooth-force')
      adopt(hook.scrollRef, node)
      api.put(hook)
      shown.put(hook.showScrollToBottom)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => {
        node.scrollTop = 1_000
        node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
        node.dispatchEvent(new Event('scroll'))
      })
      expect(shown.value).toBe(true)

      // Model the important part of native smooth scrolling: at least one
      // intermediate scroll event fires before the final bottom landing.
      node.scrollTo = ((options: ScrollToOptions) => {
        const target = options.top ?? node.scrollTop
        node.scrollTop += (target - node.scrollTop) / 2
        node.dispatchEvent(new Event('scroll'))
        node.scrollTop = target
        node.dispatchEvent(new Event('scroll'))
      }) as HTMLElement['scrollTo']

      await act(async () => api.value!.forceScrollToBottom('smooth'))
      expect(node.scrollTop).toBe(1_500)
      expect(shown.value, 'the explicit jump must re-enable follow immediately').toBe(false)

      Object.defineProperty(node, 'scrollHeight', { value: 2_200, writable: true })
      await act(async () => api.value!.scrollToBottom())
      expect(node.scrollTop, 'the next streamed growth must follow the new tail').toBe(1_700)
    } finally {
      await act(async () => root.unmount())
    }
  })
})

describe('opening a session', () => {
  test('lands at the bottom even when the saved snapshot was scrolled up', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { saveChatScrollSnapshot, clearChatScrollSnapshotsForTests } =
      await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    saveChatScrollSnapshot('s2', { scrollTop: 120, follow: false })

    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })
    function Probe({ id }: { id: string }) {
      const { scrollRef } = useAutoScroll<HTMLDivElement>(id)
      adopt(scrollRef, node)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe id="s2" />))
      await act(async () => {
        await Promise.resolve()
      })
      // OPENING a chat goes to the live tail — the reported requirement.
      expect(node.scrollTop).toBe(1_500)

      // AND A SWITCH DOES TOO. The intent ref initialises to `true`, so the first open would pass
      // even if the session effect never planted it — only a second session id proves the plant.
      saveChatScrollSnapshot('s9', { scrollTop: 90, follow: false })
      node.scrollTop = 0
      await act(async () => root.render(<Probe id="s9" />))
      await act(async () => {
        await Promise.resolve()
      })
      expect(node.scrollTop, 'switching sessions lands at the tail too').toBe(1_500)
    } finally {
      await act(async () => root.unmount())
    }
  })
})

describe('stream-follow intent boundaries', () => {
  test('a pinned viewport resize follows the tail without moving an unpinned reader', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const OriginalResizeObserver = globalThis.ResizeObserver
    const observers: Array<{
      callback: ResizeObserverCallback
      targets: Set<Element>
    }> = []
    class CapturingResizeObserver {
      readonly record = {
        callback: undefined as unknown as ResizeObserverCallback,
        targets: new Set<Element>(),
      }
      constructor(callback: ResizeObserverCallback) {
        this.record.callback = callback
        observers.push(this.record)
      }
      observe(target: Element) {
        this.record.targets.add(target)
      }
      unobserve(target: Element) {
        this.record.targets.delete(target)
      }
      disconnect() {
        this.record.targets.clear()
      }
    }
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver

    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })
    function Probe() {
      const { scrollRef } = useAutoScroll<HTMLDivElement>('viewport-resize')
      adopt(scrollRef, node)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      expect(node.scrollTop).toBe(1_500)
      const viewportObserver = observers.find((observer) => observer.targets.has(node))!

      // A taller composer / shorter workspace moves the bottom without changing
      // the transcript child's own box, so only the viewport observer sees it.
      Object.defineProperty(node, 'clientHeight', { value: 300, writable: true })
      await act(async () => viewportObserver.callback([], {} as ResizeObserver))
      expect(node.scrollTop, 'a pinned reader must follow the resized viewport').toBe(1_700)

      // Explicit reader intent remains authoritative across the same resize.
      await act(async () => {
        node.scrollTop = 600
        node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
        node.dispatchEvent(new Event('scroll'))
      })
      Object.defineProperty(node, 'clientHeight', { value: 250, writable: true })
      await act(async () => viewportObserver.callback([], {} as ResizeObserver))
      expect(node.scrollTop, 'an unpinned reader must keep their position').toBe(600)
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver
      await act(async () => root.unmount())
    }
  })

  test('scrolling a nested code or console surface does not unpin the outer chat', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })
    const nested = document.createElement('div')
    nested.dataset.scrollable = ''
    node.firstElementChild!.append(nested)
    const scrollToBottom = tap<() => void>()
    function Probe() {
      const hook = useAutoScroll<HTMLDivElement>('nested-scroll')
      adopt(hook.scrollRef, node)
      scrollToBottom.put(hook.scrollToBottom)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      expect(node.scrollTop).toBe(1_500)

      nested.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
      ;(node as unknown as { scrollHeight: number }).scrollHeight = 2_100
      await act(async () => scrollToBottom.value?.())
      expect(node.scrollTop).toBe(1_600)
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('an upward keyboard scroll unpins immediately inside the near-bottom band', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })
    const scrollToBottom = tap<() => void>()
    function Probe() {
      const hook = useAutoScroll<HTMLDivElement>('keyboard-scroll')
      adopt(hook.scrollRef, node)
      scrollToBottom.put(hook.scrollToBottom)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      await act(async () => {
        node.scrollTop = 1_460
        node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }))
      })
      ;(node as unknown as { scrollHeight: number }).scrollHeight = 2_100
      await act(async () => scrollToBottom.value?.())
      expect(node.scrollTop, 'stream growth must not pull a keyboard reader back').toBe(1_460)
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('returning focus from a board to the same mounted chat preserves its reading position', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })
    function Probe({ open }: { open: boolean }) {
      const { scrollRef } = useAutoScroll<HTMLDivElement>('warm-open', open)
      adopt(scrollRef, node)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe open />))
      await act(async () => {
        node.scrollTop = 300
        node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
        node.dispatchEvent(new Event('scroll'))
      })
      await act(async () => root.render(<Probe open={false} />))
      await act(async () => root.render(<Probe open />))
      expect(node.scrollTop).toBe(300)
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('content that grew during pointer selection catches up after pointerup', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useAutoScroll } = await import('./useAutoScroll')
    const { clearChatScrollSnapshotsForTests } = await import('./chatScrollState')

    clearChatScrollSnapshotsForTests()
    const OriginalResizeObserver = globalThis.ResizeObserver
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
    const observers: Array<{
      callback: ResizeObserverCallback
      targets: Set<Element>
    }> = []
    class CapturingResizeObserver {
      readonly record = {
        callback: undefined as unknown as ResizeObserverCallback,
        targets: new Set<Element>(),
      }
      constructor(callback: ResizeObserverCallback) {
        this.record.callback = callback
        observers.push(this.record)
      }
      observe(target: Element) {
        this.record.targets.add(target)
      }
      unobserve(target: Element) {
        this.record.targets.delete(target)
      }
      disconnect() {
        this.record.targets.clear()
      }
    }
    let nextFrameId = 0
    const frames = new Map<number, FrameRequestCallback>()
    globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      nextFrameId += 1
      frames.set(nextFrameId, callback)
      return nextFrameId
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((id: number) => {
      frames.delete(id)
    }) as typeof cancelAnimationFrame
    const flushFrames = async () => {
      const pending = [...frames.values()]
      frames.clear()
      await act(async () => {
        for (const callback of pending) callback(performance.now())
      })
    }

    const node = viewport({ scrollHeight: 2_000, clientHeight: 500, scrollTop: 0 })
    function Probe() {
      const { scrollRef } = useAutoScroll<HTMLDivElement>('blocked-growth')
      adopt(scrollRef, node)
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe />))
      await flushFrames()
      expect(node.scrollTop).toBe(1_500)

      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      ;(node as unknown as { scrollHeight: number }).scrollHeight = 2_100
      const contentObserver = observers.find((observer) =>
        observer.targets.has(node.firstElementChild!),
      )!
      contentObserver.callback([], {} as ResizeObserver)
      await flushFrames()
      expect(node.scrollTop).toBe(1_500)

      window.dispatchEvent(new PointerEvent('pointerup'))
      await flushFrames()
      expect(node.scrollTop).toBe(1_600)
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
      await act(async () => root.unmount())
    }
  })
})
