import { registerDom } from '@localixai/kit/testing'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'

import { centre, useGlide, type Point } from './useGlide'

const SIZE = 16
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  if (priorActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment
})

/** Animation frames the test fires by hand, at a clock it sets. */
function manualFrames() {
  const queue = new Map<number, FrameRequestCallback>()
  let next = 1
  const realNow = performance.now.bind(performance)
  const original = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame }
  let clock = 0
  globalThis.requestAnimationFrame = (callback) => {
    queue.set(next, callback)
    return next++
  }
  globalThis.cancelAnimationFrame = (id) => void queue.delete(id)
  performance.now = () => clock
  return {
    /** Move the clock to `at` and run the frames that were waiting. */
    async frame(at: number) {
      clock = at
      const due = [...queue.values()]
      queue.clear()
      await act(async () => {
        for (const callback of due) callback(at)
      })
    },
    restore() {
      performance.now = realNow
      globalThis.requestAnimationFrame = original.raf
      globalThis.cancelAnimationFrame = original.caf
    },
  }
}

test('a new step starts where the snake was drawn and eases to its cell over its duration', async () => {
  const frames = manualFrames()
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  const seen: Point[][] = []
  function Probe({ snake }: { snake: number[] }) {
    seen.push(useGlide(snake, SIZE, 400))
    return null
  }
  try {
    await act(async () => root.render(<Probe snake={[34, 33]} />))
    await frames.frame(0)
    await act(async () => root.render(<Probe snake={[35, 34]} />))
    // The first frame of the step is still the old position: no jump.
    expect(seen.at(-1)![0]).toEqual(centre(34, SIZE))
    await frames.frame(0)
    await frames.frame(200)
    expect(seen.at(-1)![0]!.x).toBeCloseTo(centre(34, SIZE).x + 0.5, 5)
    await frames.frame(400)
    expect(seen.at(-1)).toEqual([centre(35, SIZE), centre(34, SIZE)])
    // The glide is over: nothing is waiting for another frame.
    const drawn = seen.length
    await frames.frame(600)
    expect(seen.length).toBe(drawn)
  } finally {
    await act(async () => root.unmount())
    frames.restore()
  }
})
