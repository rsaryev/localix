/**
 * Regression: the agent could not toggle a page's theme via
 * the `browser` tool, though the user clicking the SAME icon button worked. Root cause —
 * TARGET ASYMMETRY. The snapshot walker stops at the interactive `<button>`, so the
 * agent can only target the button; `synthClick` then dispatched every event on that
 * RESOLVED button, making `event.target` = the button. A TRUSTED click's `event.target`
 * is the DEEPEST node under the point — the inner `<span class="theme-icon">`. Any
 * handler whose activation depends on the target being (inside) the child — a listener
 * bound on the child, OR one DELEGATED on `e.target.closest('.theme-icon')` — fires for
 * the user but NOT for the old synthClick. The button even focused (we focus the
 * resolved control), which is exactly the reported "focus lands but the handler never
 * runs" symptom.
 *
 * The fix dispatches the pointer/mouse/click sequence on `deepElementFromPoint(center)`
 * when it is contained by the resolved control (mirroring a trusted target), while
 * STILL focusing the resolved control. happy-dom has no layout (elementFromPoint → null),
 * so these tests MOCK it to return the deepest node a real click would hit.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'

// Stub settle → deterministic, no rAF wait; the dispatch TARGET is what we test here.
function makeDeps(): ActuateDeps {
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
const ICON_BUTTON =
  '<div id="root"><button id="tt" aria-label="Toggle theme"><span class="theme-icon">🌙</span></button></div>'

describe('click dispatches on the deepest hit node', () => {
  let realEFP: typeof document.elementFromPoint
  beforeAll(() => {
    GlobalRegistrator.register()
    // Capture the ORIGINAL implementation with its receiver. A forwarding closure
    // that reads `document.elementFromPoint` here becomes recursively self-referential
    // after `afterEach` restores that closure, hanging the next no-layout test.
    realEFP = document.elementFromPoint.bind(document)
  })
  afterAll(() => GlobalRegistrator.unregister())
  afterEach(() => {
    document.elementFromPoint = realEFP
  }) // undo per-test mocks

  test('FIXED: a click reaches an ICON-delegated handler (target = the deep span, not the button)', async () => {
    document.body.innerHTML = ICON_BUTTON
    const root = document.getElementById('root')!
    const btn = document.getElementById('tt')!
    const icon = btn.querySelector('.theme-icon')!
    // Model the deepest node a trusted click at the button center would hit: the icon.
    document.elementFromPoint = (() => icon) as typeof document.elementFromPoint

    let activations = 0
    // Delegated on an ANCESTOR, keyed on the ICON child (which never gets a snapshot
    // ref). Activates only when event.target is inside .theme-icon — i.e. only when the
    // click is dispatched on the deepest node, exactly as a trusted click would be.
    root.addEventListener('click', (e) => {
      if ((e.target as Element | null)?.closest?.('.theme-icon')) activations += 1
    })

    const deps = makeDeps()
    const ref = firstRef(buildSnapshot(deps.reg).tree) // only the BUTTON is interactive
    const r = await runCommand({ action: 'click', ref }, deps)

    expect(r.ok).toBe(true)
    expect(activations).toBe(1) // the icon-delegated handler ran (was 0 pre-fix)
    expect(document.activeElement).toBe(btn) // focus still lands on the RESOLVED control
  })

  test('PRE-FIX behavior would MISS it: dispatching on the resolved button never reaches the icon handler', () => {
    document.body.innerHTML = ICON_BUTTON
    const root = document.getElementById('root')!
    const btn = document.getElementById('tt')!
    let activations = 0
    root.addEventListener('click', (e) => {
      if ((e.target as Element | null)?.closest?.('.theme-icon')) activations += 1
    })
    // Reproduce the OLD synthClick: dispatch the click on the RESOLVED element (button),
    // so event.target = the button and the icon-keyed delegated handler is skipped.
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }))
    expect(activations).toBe(0) // the bug the fix corrects
  })

  test('no regression: a plain button (no children) still dispatches on itself', async () => {
    document.body.innerHTML = '<button id="tt">Go</button>'
    const btn = document.getElementById('tt')!
    document.elementFromPoint = (() => btn) as typeof document.elementFromPoint // deep node IS the button
    let calls = 0
    btn.addEventListener('click', () => {
      calls += 1
    })

    const deps = makeDeps()
    const ref = firstRef(buildSnapshot(deps.reg).tree)
    const r = await runCommand({ action: 'click', ref }, deps)

    expect(r.ok).toBe(true)
    expect(calls).toBe(1)
    expect(document.activeElement).toBe(btn)
  })

  test('no regression: with no layout (elementFromPoint null) the click falls back to the resolved control', async () => {
    document.body.innerHTML = '<button id="tt">Go</button>'
    const btn = document.getElementById('tt')! // default happy-dom elementFromPoint → null
    let calls = 0
    btn.addEventListener('click', () => {
      calls += 1
    })

    const deps = makeDeps()
    const ref = firstRef(buildSnapshot(deps.reg).tree)
    const r = await runCommand({ action: 'click', ref }, deps)

    expect(r.ok).toBe(true)
    expect(calls).toBe(1) // dispatched on the button (fallback) — today's behavior, unchanged
  })

  test('a hit OUTSIDE the resolved control (an overlay) is NOT used — dispatch stays on the control', async () => {
    document.body.innerHTML = '<button id="tt">Go</button><div id="overlay">x</div>'
    const btn = document.getElementById('tt')!
    const overlay = document.getElementById('overlay')!
    // deepElementFromPoint returns an element NOT contained by the button → must fall back
    // to the button (we never dispatch outside the resolved control).
    document.elementFromPoint = (() => overlay) as typeof document.elementFromPoint
    let onBtn = 0
    let onOverlay = 0
    btn.addEventListener('click', () => {
      onBtn += 1
    })
    overlay.addEventListener('click', () => {
      onOverlay += 1
    })

    const deps = makeDeps()
    const ref = firstRef(buildSnapshot(deps.reg).tree)
    const r = await runCommand({ action: 'click', ref }, deps)

    expect(r.ok).toBe(true)
    expect(onBtn).toBe(1) // dispatched on the resolved control
    expect(onOverlay).toBe(0) // never on the out-of-control hit
  })

  test('hover likewise dispatches on the deepest hit node (icon-delegated mouseover fires)', async () => {
    document.body.innerHTML =
      '<div id="root"><button id="tt" aria-label="Menu"><span class="theme-icon">≡</span></button></div>'
    const root = document.getElementById('root')!
    const icon = document.querySelector('.theme-icon')!
    document.elementFromPoint = (() => icon) as typeof document.elementFromPoint
    let hovers = 0
    root.addEventListener('mouseover', (e) => {
      if ((e.target as Element | null)?.closest?.('.theme-icon')) hovers += 1
    })

    const deps = makeDeps()
    const ref = firstRef(buildSnapshot(deps.reg).tree)
    const r = await runCommand({ action: 'hover', ref }, deps)

    expect(r.ok).toBe(true)
    expect(hovers).toBe(1)
  })
})
