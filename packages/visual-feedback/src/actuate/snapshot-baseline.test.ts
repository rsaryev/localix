/**
 * Regression (the "first click looked like it worked" false positive):
 * the change-diff baseline is seeded when a snapshot runs. For a proxied Vite SPA the
 * runtime CSS (`<style>` injected by the dev server) lands in the window AFTER the
 * snapshot but BEFORE the first action — flipping the body background transparent→white.
 * If the baseline is seeded SYNCHRONOUSLY (before that CSS paints), the next action's
 * diff misreports the late stylesheet's color change as the action's own effect, so a
 * click that did nothing looks like it toggled the theme.
 *
 * Fix: the `snapshot` action settles (rAF + transitions) BEFORE seeding the baseline,
 * so the baseline reflects the painted/CSS-applied page. We model the late CSS by
 * mutating the color inside the injected settle on its FIRST invocation.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { createRefRegistry } from '../snapshot/index'

describe('snapshot baseline settles before seeding the diff', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('late CSS that lands during the snapshot settle is NOT attributed to the next action', async () => {
    document.documentElement.removeAttribute('data-theme')
    document.body.style.backgroundColor = 'rgb(0, 0, 0)' // pre-paint color (proxy CSS not yet landed)
    document.body.innerHTML = '<button id="t">Theme</button>'
    // The click does NOTHING to the page — any color delta must come from the late CSS.
    ;(document.querySelector('#t') as HTMLButtonElement).onclick = () => {}

    // Injected settle stands in for the rAF/transition wait. It flips the background to
    // white the FIRST time it runs — modeling the proxied Vite runtime CSS landing in the
    // window between the baseline snapshot and the first action. In the FIXED code the
    // snapshot settles FIRST (so this fires while seeding the baseline → baseline = white);
    // in the OLD code the snapshot seeds synchronously (baseline = black) and this fires on
    // the click's settle instead → the diff wrongly shows a black→white background change.
    let settleCalls = 0
    const settle = async () => {
      settleCalls += 1
      if (settleCalls === 1) document.body.style.backgroundColor = 'rgb(255, 255, 255)'
    }
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle,
    }

    // Seed the baseline the way the tool does — via the snapshot action.
    const snap = await runCommand({ action: 'snapshot' }, deps)
    expect(snap.ok).toBe(true)
    const ref = /\[ref=(e\d+)\]/.exec(snap.result?.snapshot?.tree ?? '')![1]

    const r = await runCommand({ action: 'click', ref }, deps)
    expect(r.ok).toBe(true)
    const diff = r.result?.diff ?? ''
    // The color settled during the SNAPSHOT (it is in the baseline), so a no-op click must
    // report no background change. On the old code the baseline was black and this fails.
    expect(diff).not.toContain('viewport bg')
  })
})
