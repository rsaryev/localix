/**
 * Regression: the agent could not theme-toggle a Vite+React app,
 * though manual clicks worked. Root cause — React (18/19 `createRoot`) attaches ONE
 * DELEGATED `click` listener on the root container and relies on the click bubbling
 * to it AS A REAL GESTURE. `synthClick`'s events omitted fields a real click always
 * carries (`composed`, `detail`, `buttons`; the pointer events also
 * `pressure`/`pointerType`), so a delegated consumer that guards on the gesture never
 * activated — the click reached the button's DOM but the app saw nothing.
 *
 * The EXISTING actuate tests (theme-toggle, play-theme-toggle) wire handlers DIRECTLY
 * on the node (`.onclick` / `addEventListener`), so they fire regardless of delegation
 * or gesture fields and never caught this. These two tests cover the gap:
 *   1. A faithful model of React's delegation (ONE listener on a container ANCESTOR
 *      that treats the click as a real activation only when it carries a gesture
 *      `detail`) — FAILS on the old inits, passes on the new. The discriminator.
 *   2. A field-level lock pinning the exact enriched inits the fix adds.
 *
 * (A real `createRoot` root was tried too — but React itself does NOT filter on these
 * fields, so it fires `onClick` either way and does not discriminate the fix; under
 * happy-dom it also leaves a scheduler task that dereferences `window` after teardown.
 * So the faithful delegation model above is the lock, per the brief's fallback.)
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { synthClick } from './input'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'

function makeDeps(): ActuateDeps {
  // Stub settle → deterministic, no rAF wait; delegation/gesture is what we test.
  return {
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {},
  }
}
function firstRef(tree: string): string {
  const m = /\[ref=(e\d+)\]/.exec(tree)
  if (!m) throw new Error(`no interactive ref in tree:\n${tree}`)
  return m[1]
}

describe('React delegated-onClick actuation', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('DISCRIMINATOR: a delegated listener guarding on gesture detail fires under synthClick 3×', async () => {
    document.body.innerHTML = '<div id="root"><button id="tt">Toggle theme</button></div>'
    const rootEl = document.getElementById('root')!
    const btn = document.getElementById('tt')!
    let activations = 0
    // React-style delegation: ONE listener on a container ANCESTOR (not the node). A
    // real component only activates on a genuine pointer gesture — `detail` is the
    // click count, ≥1 for a real click, 0 for a synthetic/keyboard one. This guard is
    // a common real-world pattern and is exactly what the old (detail-less) synthClick
    // failed to satisfy, so the delegated handler never ran ("zero times").
    rootEl.addEventListener('click', (e) => {
      if ((e as MouseEvent).detail < 1) return
      const target = e.target as Element | null
      if (target === btn || target?.closest?.('#tt')) activations += 1
    })

    const deps = makeDeps()
    const ref = firstRef(buildSnapshot(deps.reg).tree)
    for (let i = 1; i <= 3; i++) {
      const r = await runCommand({ action: 'click', ref }, deps)
      expect(r.ok).toBe(true)
      expect(activations).toBe(i) // the DELEGATED, gesture-guarded handler ran
    }
  })

  test('field lock: synthClick synthesizes real-gesture inits (composed/detail/buttons/pressure)', () => {
    document.body.innerHTML = '<button id="tt">Go</button>'
    const btn = document.getElementById('tt')!
    const seen: Record<string, MouseEvent> = {}
    for (const t of [
      'pointerover',
      'pointerdown',
      'pointerup',
      'mouseover',
      'mousedown',
      'mouseup',
      'click',
    ]) {
      btn.addEventListener(t, (e) => {
        seen[t] = e as MouseEvent
      })
    }
    synthClick(btn)

    // MouseEvents: composed always; detail 1 on the click-ish trio; buttons 1 down / 0 up+click.
    for (const t of ['mousedown', 'mouseup', 'click']) {
      expect(seen[t]?.composed).toBe(true)
      expect(seen[t]?.detail).toBe(1)
    }
    expect(seen.mousedown.buttons).toBe(1)
    expect(seen.mouseup.buttons).toBe(0)
    expect(seen.click.buttons).toBe(0)
    // mouseover is not a click-ish event → no synthetic gesture pressed.
    expect(seen.mouseover.detail).toBe(0)

    // PointerEvents mirror the buttons + carry pressure/pointerType/isPrimary.
    const pd = seen.pointerdown as PointerEvent
    const pu = seen.pointerup as PointerEvent
    expect(pd.composed).toBe(true)
    expect(pd.pointerType).toBe('mouse')
    expect(pd.isPrimary).toBe(true)
    expect(pd.buttons).toBe(1)
    expect(pd.pressure).toBe(0.5)
    expect(pu.buttons).toBe(0)
    expect(pu.pressure).toBe(0)
  })
})
