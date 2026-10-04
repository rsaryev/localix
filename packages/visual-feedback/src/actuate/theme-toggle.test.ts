/**
 * End-to-end DOM regression for the "couldn't toggle the theme" report,
 * reproducing the session's final wiring: a button with an inline `onclick` attribute
 * AND an IIFE that overwrites the `.onclick` PROPERTY, whose handler flips
 * `html[data-theme]`. Asserts our synthClick fires it EXACTLY once and that the
 * change-diff REPORTS the attribute/color flip (rather than gaslighting the model
 * with "(no visible change)"). Also proves a ref from a prior page load can never
 * dispatch on a detached node while claiming success.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { stateForDiff } from './diff'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'

function makeDeps(): ActuateDeps {
  return { reg: createRefRegistry(), console: installConsoleCapture(), prevTree: { value: '' } }
}
function refInTree(tree: string): string {
  const m = /\[ref=(e\d+)\]/.exec(tree)
  if (!m) throw new Error(`no ref in tree: ${tree}`)
  return m[1]
}

describe('theme toggle actuation', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  test('synthClick fires an .onclick-property handler (theme flip) exactly once', async () => {
    document.body.innerHTML = `<button id="t">Toggle theme</button>`
    const btn = document.querySelector('#t') as HTMLButtonElement
    btn.setAttribute('onclick', 'void 0') // inline attribute present…
    let calls = 0
    // …an IIFE overwrites the property — THIS is the handler that actually runs.
    btn.onclick = () => {
      calls += 1
      const cur = document.documentElement.getAttribute('data-theme')
      document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark')
    }

    const deps = makeDeps()
    const ref = refInTree(buildSnapshot(deps.reg).tree)
    deps.prevTree.value = stateForDiff() // seed the diff baseline like a snapshot would

    const r = await runCommand({ action: 'click', ref }, deps)
    expect(r.ok).toBe(true)
    expect(calls).toBe(1) // fired exactly once (not zero, not twice)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  test('the change-diff REPORTS a data-theme flip (no false "no visible change")', async () => {
    document.body.innerHTML = `<button id="t">Toggle theme</button>`
    const btn = document.querySelector('#t') as HTMLButtonElement
    btn.onclick = () => document.documentElement.setAttribute('data-theme', 'dark')

    const deps = makeDeps()
    const ref = refInTree(buildSnapshot(deps.reg).tree)
    deps.prevTree.value = stateForDiff()

    const r = await runCommand({ action: 'click', ref }, deps) // snapshotAfter defaults off → diff
    expect(r.ok).toBe(true)
    expect(r.result?.snapshot).toBeUndefined() // cheap diff path, not a full tree
    expect(r.result?.diff ?? '').toContain('data-theme')
  })

  test('a ref from a prior page load never dispatches on a detached node', async () => {
    document.body.innerHTML = `<button id="old">Old</button>`
    const depsA = makeDeps()
    const ref = refInTree(buildSnapshot(depsA.reg).tree)

    // Simulate a full reload: a brand-new probe instance (fresh registry, empty
    // prev-gen) over a re-rendered DOM. The old ref must resolve to nothing.
    document.body.innerHTML = `<button id="new">New</button>`
    let fired = false
    document.querySelector('#new')!.addEventListener('click', () => {
      fired = true
    })
    const depsB = makeDeps()

    const r = await runCommand({ action: 'click', ref }, depsB)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('not_found')
    expect(fired).toBe(false) // never dispatched on any node
    expect(r.result?.snapshot?.tree).toContain('New') // fresh snapshot handed back
  })
})
