/**
 * browser benchmark · theme toggle (RE-RENDER) — the case the three static
 * HTML fixtures never exercised: an element the page RE-MOUNTS between actions.
 *
 * A theme toggle that, on each click, replaces its own button node (a React-style
 * re-render) is exactly what made driving a re-rendering app a death-loop: the ref went
 * stale the instant the page re-rendered, and every subsequent `click @e3` failed
 * "ref not found". This fixture clicks the SAME ref twice WITHOUT re-snapshotting
 * and asserts both clicks land — guarding the self-healing-ref fix (ref-registry
 * re-resolves a detached ref by its captured selector).
 */

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { buildSnapshot, createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from '../actuate/index'

/** (Re)mount the toggle button into #app and wire a click handler that toggles the
 *  theme AND re-mounts itself — i.e. replaces the button node every click. */
function mountToggle(state: { count: number }): void {
  const app = document.getElementById('app')!
  app.innerHTML = `<button class="theme-toggle" id="tt">Toggle theme</button>`
  document.getElementById('tt')!.addEventListener('click', () => {
    state.count++
    document.body.classList.toggle('dark')
    mountToggle(state) // re-render: the clicked node is replaced by a fresh one
  })
}

describe('browser benchmark · theme toggle (re-render)', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('clicking a ref the page RE-RENDERS still lands (self-healing ref)', async () => {
    document.body.innerHTML = `<div id="app"></div>`
    const state = { count: 0 }
    mountToggle(state)

    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
    }
    const snap = buildSnapshot(deps.reg)
    const ref = (snap.tree.match(/\[ref=(e\d+)\]/) ?? [])[1]
    expect(ref).toBeDefined() // the toggle is the interactive node

    // First click: lands, toggles, and RE-MOUNTS the button (old node detached).
    const r1 = await runCommand({ action: 'click', ref }, deps)
    expect(r1.ok).toBe(true)
    expect(state.count).toBe(1)

    // Second click on the SAME ref, WITHOUT re-snapshotting. The original node is
    // gone; the registry must re-resolve to the freshly-mounted button so the click
    // lands — before the fix this failed with "ref not found — the page changed".
    const r2 = await runCommand({ action: 'click', ref }, deps)
    expect(r2.ok).toBe(true)
    expect(state.count).toBe(2)
  })
})
