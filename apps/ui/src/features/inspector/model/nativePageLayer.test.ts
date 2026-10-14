import { expect, test } from 'bun:test'
import {
  CAPTURE_BUDGET_MS,
  createNativePageLayer,
  type PageBounds,
  type PageFrame,
} from './nativePageLayer'

const FRAME: PageFrame = { x: 10, y: 80, width: 800, height: 600 }

/** A layer wired to fakes: a manual clock, a capture the test settles, a picture log. */
function harness() {
  const applied: PageBounds[] = []
  const pictures: string[] = []
  const pauses: boolean[] = []
  const timers = new Map<number, { at: number; task: () => void }>()
  let now = 0
  let nextTimer = 0
  let finishCapture: ((url: string) => void) | null = null
  let failCapture: ((reason: Error) => void) | null = null
  const captures: number[] = []
  const layer = createNativePageLayer({
    apply: (bounds) => applied.push(bounds),
    capture: () => {
      captures.push(now)
      return new Promise<string>((resolve, reject) => {
        finishCapture = resolve
        failCapture = reject
      })
    },
    showPicture: async (url) => {
      pictures.push(url)
    },
    setPaused: (paused) => pauses.push(paused),
    schedule: (task, ms) => {
      const id = nextTimer++
      timers.set(id, { at: now + ms, task })
      return () => timers.delete(id)
    },
  })
  const flush = async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve()
  }
  return {
    layer,
    applied,
    pictures,
    pauses,
    captures,
    visible: () => applied.at(-1)?.visible ?? false,
    advance: async (ms: number) => {
      now += ms
      const due = Array.from(timers).filter(([, timer]) => timer.at <= now)
      for (const [id, timer] of due) {
        timers.delete(id)
        timer.task()
      }
      await flush()
    },
    capture: async (url: string) => {
      finishCapture?.(url)
      await flush()
    },
    failCapture: async () => {
      failCapture?.(new Error('capture unsupported'))
      await flush()
    },
  }
}

function livePage() {
  const page = harness()
  page.layer.setActive(true)
  page.layer.setFrame(FRAME)
  page.layer.opened()
  return page
}

test('nothing reaches the native side before the page exists', () => {
  const page = harness()
  page.layer.setActive(true)
  page.layer.setFrame(FRAME)
  page.layer.setOverlay(false)
  page.layer.dispose()
  expect(page.applied).toEqual([])
})

test('an open, active, laid-out page is live at its frame', () => {
  const page = livePage()
  expect(page.applied.at(-1)).toEqual({ ...FRAME, visible: true })
})

test('the page is hidden while its tab is inactive or its box is not displayed', () => {
  const page = livePage()
  page.layer.setActive(false)
  expect(page.visible()).toBe(false)
  page.layer.setActive(true)
  page.layer.setFrame(null)
  expect(page.visible()).toBe(false)
  page.layer.setFrame({ ...FRAME, width: 0 })
  expect(page.visible()).toBe(false)
})

test('an overlay keeps the page live until its picture is painted, then hides it', async () => {
  const page = livePage()
  page.layer.setOverlay(true)
  expect(page.captures).toHaveLength(1)
  expect(page.visible()).toBe(true)

  await page.capture('data:image/jpeg;base64,frame')
  expect(page.pictures).toEqual(['data:image/jpeg;base64,frame'])
  expect(page.visible()).toBe(false)
})

test('the page reads as paused exactly while it is stepped aside', async () => {
  const page = livePage()
  page.layer.setOverlay(true)
  expect(page.pauses).toEqual([])
  await page.capture('data:image/jpeg;base64,frame')
  expect(page.pauses).toEqual([true])

  page.layer.setOverlay(false)
  await page.advance(0)
  expect(page.pauses).toEqual([true, false])
})

test('a slow capture never holds the overlay back past the budget', async () => {
  const page = livePage()
  page.layer.setOverlay(true)
  await page.advance(CAPTURE_BUDGET_MS - 1)
  expect(page.visible()).toBe(true)
  await page.advance(1)
  expect(page.visible()).toBe(false)

  // The late picture still lands under the overlay that asked for it.
  await page.capture('data:image/jpeg;base64,late')
  expect(page.pictures).toEqual(['data:image/jpeg;base64,late'])
})

test('a host that cannot capture hides the page at once', async () => {
  const page = livePage()
  page.layer.setOverlay(true)
  await page.failCapture()
  expect(page.visible()).toBe(false)
  expect(page.pictures).toEqual([])
})

test('the page comes back when the overlay closes, and a stale picture is dropped', async () => {
  const page = livePage()
  page.layer.setOverlay(true)
  page.layer.setOverlay(false)
  await page.advance(0)
  expect(page.visible()).toBe(true)

  await page.capture('data:image/jpeg;base64,stale')
  expect(page.pictures).toEqual([])
  expect(page.visible()).toBe(true)
})

test('a menu closing as the next opens does not flash the live page between them', async () => {
  const page = livePage()
  page.layer.setOverlay(true)
  await page.capture('data:image/jpeg;base64,first')
  const hiddenAt = page.applied.length

  page.layer.setOverlay(false)
  page.layer.setOverlay(true)
  await page.advance(0)
  expect(page.applied.slice(hiddenAt).some((bounds) => bounds.visible)).toBe(false)
  expect(page.captures).toHaveLength(1)
})

test('an overlay already up when the page opens keeps it hidden without a capture', async () => {
  const page = harness()
  page.layer.setOverlay(true)
  page.layer.setActive(true)
  page.layer.setFrame(FRAME)
  page.layer.opened()
  expect(page.visible()).toBe(false)
  expect(page.captures).toHaveLength(0)

  page.layer.setOverlay(false)
  await page.advance(0)
  expect(page.visible()).toBe(true)
})

test('a resize while yielded moves the hidden page, and it returns at the new frame', async () => {
  const page = livePage()
  page.layer.setOverlay(true)
  await page.capture('data:image/jpeg;base64,frame')
  const moved = { ...FRAME, width: 500 }
  page.layer.setFrame(moved)
  expect(page.applied.at(-1)).toEqual({ ...moved, visible: false })

  page.layer.setOverlay(false)
  await page.advance(0)
  expect(page.applied.at(-1)).toEqual({ ...moved, visible: true })
})

test('dispose hides the page and ignores whatever is still in flight', async () => {
  const page = livePage()
  page.layer.setOverlay(true)
  page.layer.dispose()
  expect(page.visible()).toBe(false)
  const settledAt = page.applied.length

  await page.capture('data:image/jpeg;base64,after')
  await page.advance(CAPTURE_BUDGET_MS)
  page.layer.setFrame(FRAME)
  expect(page.applied).toHaveLength(settledAt)
  expect(page.pictures).toEqual([])
})

test('a drag yields immediately without waiting for the picture budget', async () => {
  const page = livePage()
  page.layer.setOverlay(true, true)
  expect(page.visible()).toBe(false)
  await page.capture('data:image/jpeg;base64,drag')
  expect(page.visible()).toBe(false)
  page.layer.setOverlay(false)
  await page.advance(0)
  expect(page.visible()).toBe(true)
})

test('a disposed layer ignores a late open, activation and frame instead of showing another panel', () => {
  const page = harness()
  page.layer.setActive(true)
  page.layer.setFrame(FRAME)
  page.layer.dispose()
  page.layer.opened()
  page.layer.setActive(true)
  page.layer.setFrame(FRAME)
  expect(page.applied).toEqual([])
})
