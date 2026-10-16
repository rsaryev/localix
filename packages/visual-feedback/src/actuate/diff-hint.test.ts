/**
 * The "attribute flipped but computed colors did not" hint — turns the
 * mystery (theme attribute toggles, page never restyles because its CSS didn't load)
 * into an actionable message. Pure-function tests plus one end-to-end through the
 * dispatcher (happy-dom has no stylesheet, so a data-theme flip leaves colors equal).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { annotateDiff } from './diff'
import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { stateForDiff } from './diff'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'

const HINT = 'attribute changed but computed colors did not'

describe('annotateDiff', () => {
  test('adds the hint when an html/body attribute flips with no viewport color change', () => {
    const diff = '- body data-theme="dark"\n+ body data-theme="light"'
    expect(annotateDiff(diff)).toContain(HINT)
  })

  test('adds the hint for a body CLASS flip too', () => {
    const diff = '- body class="theme-dark"\n+ body class="theme-light"'
    expect(annotateDiff(diff)).toContain(HINT)
  })

  test('does NOT add the hint when the viewport colors DID change', () => {
    const diff = [
      '- body data-theme="dark"',
      '- viewport bg=rgb(0, 0, 0) fg=rgb(255, 255, 255)',
      '+ body data-theme="light"',
      '+ viewport bg=rgb(255, 255, 255) fg=rgb(0, 0, 0)',
    ].join('\n')
    expect(annotateDiff(diff)).not.toContain(HINT)
  })

  test('does NOT add the hint for an ordinary (non-attribute) change', () => {
    const diff = '+ button "Submit" [ref=e3]'
    expect(annotateDiff(diff)).not.toContain(HINT)
    expect(annotateDiff(diff)).toBe(diff)
  })
})

describe('diff hint end-to-end (dispatcher)', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('a theme-attr flip whose CSS did not apply surfaces the hint in the click diff', async () => {
    document.documentElement.removeAttribute('data-theme')
    document.body.innerHTML = '<button id="t">Theme</button>'
    ;(document.querySelector('#t') as HTMLButtonElement).onclick = () => {
      document.body.setAttribute('data-theme', 'dark') // flips the attr; no stylesheet → colors unchanged
    }
    // Immediate settle (no transition to wait for) — colors still don't change → hint.
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle: async () => {},
    }
    const ref = /\[ref=(e\d+)\]/.exec(buildSnapshot(deps.reg).tree)![1]
    deps.prevTree.value = stateForDiff()

    const r = await runCommand({ action: 'click', ref }, deps)
    expect(r.ok).toBe(true)
    expect(r.result?.diff ?? '').toContain('data-theme') // the flip is reported…
    expect(r.result?.diff ?? '').toContain(HINT) // …with the actionable hint
  })

  test('the diff resamples colors AFTER the settle window, so a transition-animated change is caught (NO false hint)', async () => {
    // Reproduce the late-restyle timing: the restyled color lands only after the CSS
    // transition finishes. We model that by mutating the color INSIDE the injected
    // settle (which stands in for the rAF + getAnimations wait). A synchronous sample
    // would read the OLD color and wrongly emit the "colors did not change" hint.
    document.body.removeAttribute('data-theme')
    document.body.style.backgroundColor = 'rgb(0, 0, 0)'
    document.body.innerHTML = '<button id="t">Theme</button>'
    ;(document.querySelector('#t') as HTMLButtonElement).onclick = () => {
      document.body.setAttribute('data-theme', 'light') // attr flips synchronously…
    }
    const settle = async () => {
      // …but the computed color only settles later (the transition completing).
      document.body.style.backgroundColor = 'rgb(255, 255, 255)'
    }
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle,
    }
    const ref = /\[ref=(e\d+)\]/.exec(buildSnapshot(deps.reg).tree)![1]
    deps.prevTree.value = stateForDiff() // baseline: bg is black

    const r = await runCommand({ action: 'click', ref }, deps)
    expect(r.ok).toBe(true)
    const diff = r.result?.diff ?? ''
    expect(diff).toContain('viewport bg=rgb(255, 255, 255)') // sampled AFTER settle
    expect(diff).not.toContain(HINT) // colors DID change → no false "nothing happened" hint
  })
})
