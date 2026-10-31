/**
 * A click lands where its control is on screen. Two covers stood in the way on a real booking
 * site: a loading veil that is gone a moment later, and an app-install banner with its own
 * buttons. A person waits out the first and answers the second; the actuator waits a moment
 * for a cover to go, and when one stays it names that layer's controls with their refs.
 * happy-dom has no layout, so the hit test and the box are stubbed; the clock is fake.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'

function fakeClock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms), elapsed: () => t }
}

function laidOut(el: Element) {
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 }) as DOMRect
}

describe('a covered click', () => {
  let realHitTest: typeof document.elementFromPoint
  beforeAll(() => {
    GlobalRegistrator.register()
    realHitTest = document.elementFromPoint.bind(document)
  })
  afterAll(() => GlobalRegistrator.unregister())
  afterEach(() => {
    document.elementFromPoint = realHitTest
  })

  test('waits out a cover that goes away, then clicks', async () => {
    document.body.innerHTML = '<button id="city">Kutaisi</button><div id="veil"></div>'
    const city = document.getElementById('city')!
    const veil = document.getElementById('veil')!
    laidOut(city)
    let hits = 0
    document.elementFromPoint = () => (++hits <= 3 ? veil : city)
    let clicked = 0
    city.addEventListener('click', () => clicked++)
    const clock = fakeClock()
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle: async () => {},
      clock,
    }
    const ref = /\[ref=(e\d+)\]/.exec(buildSnapshot(deps.reg).tree)![1]

    const r = await runCommand({ action: 'click', ref }, deps)

    expect(r.ok).toBe(true)
    expect(clicked).toBe(1)
    expect(clock.elapsed()).toBeLessThan(1000)
  })

  test('a cover that stays is named with the controls of its layer, and nothing is clicked', async () => {
    document.body.innerHTML = `
      <button id="georgia">Georgia from $27</button>
      <div id="overlays">
        <div id="backdrop"></div>
        <div class="banner">
          <p>Get the app</p>
          <button>Stay in browser</button>
          <button>Open the app</button>
        </div>
      </div>`
    const georgia = document.getElementById('georgia')!
    laidOut(georgia)
    document.elementFromPoint = () => document.getElementById('backdrop')
    let clicked = 0
    georgia.addEventListener('click', () => clicked++)
    const clock = fakeClock()
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle: async () => {},
      clock,
    }
    const ref = /- button "Georgia from \$27" \[ref=(e\d+)\]/.exec(buildSnapshot(deps.reg).tree)![1]

    const r = await runCommand({ action: 'click', ref }, deps)

    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('intercepted')
    expect(clicked).toBe(0)
    const tree = r.result?.snapshot?.tree ?? ''
    const stay = /- button "Stay in browser" \[ref=(e\d+)\]/.exec(tree)?.[1]
    const open = /- button "Open the app" \[ref=(e\d+)\]/.exec(tree)?.[1]
    expect(r.error).toContain(`button "Stay in browser" [${stay}]`)
    expect(r.error).toContain(`button "Open the app" [${open}]`)
    expect(r.error).not.toMatch(/dismiss it|then retry/i)
  })
})
