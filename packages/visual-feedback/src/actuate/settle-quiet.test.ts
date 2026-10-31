/**
 * After an action the page is resampled only once its DOM has been quiet: a result that arrives
 * from the network a moment after a click must be in the diff, not a false "(no visible change)".
 * Time is injected, so nothing here sleeps.
 */
import { expect, test } from 'bun:test'

import { settleTransitions, type SettleEnv } from './settle'

/** A clock the settle advances by sleeping; `mutations` are the times the page's DOM changes. */
function fakePage(mutations: number[], animatingUntil = 0) {
  let t = 0
  let onMutation: () => void = () => {}
  let pending = [...mutations].sort((a, b) => a - b)
  const env: SettleEnv = {
    now: () => t,
    frame: async () => {},
    sleep: async (ms) => {
      t += ms
      while (pending.length && pending[0]! <= t) {
        pending.shift()
        onMutation()
      }
    },
    watch: (cb) => {
      onMutation = cb
      return () => {
        onMutation = () => {}
      }
    },
    animating: () => t < animatingUntil,
  }
  return { env, elapsed: () => t, unwatched: () => pending.length }
}

const within = (n: number, min: number, max: number) => {
  expect(n).toBeGreaterThanOrEqual(min)
  expect(n).toBeLessThan(max)
}

test('a quiet page settles once it has been quiet for 100 ms', async () => {
  const page = fakePage([])
  await settleTransitions(700, page.env)
  within(page.elapsed(), 100, 120)
})

test('a change that lands 90 ms after the click restarts the quiet window', async () => {
  const page = fakePage([90])
  await settleTransitions(700, page.env)
  within(page.elapsed(), 190, 210)
})

test('a page that never stops changing is cut off at the cap', async () => {
  const page = fakePage(Array.from({ length: 200 }, (_, i) => i * 10))
  await settleTransitions(700, page.env)
  within(page.elapsed(), 700, 720)
})

test('a running animation keeps the settle waiting even in a quiet DOM', async () => {
  const page = fakePage([], 300)
  await settleTransitions(700, page.env)
  within(page.elapsed(), 300, 320)
})

test('the DOM watcher is released when the settle ends', async () => {
  const page = fakePage([])
  let released = false
  const base = page.env.watch
  await settleTransitions(700, {
    ...page.env,
    watch: (cb) => {
      const stop = base(cb)
      return () => {
        released = true
        stop()
      }
    },
  })
  expect(released).toBe(true)
})
