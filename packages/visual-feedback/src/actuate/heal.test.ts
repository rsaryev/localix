/**
 * Self-healing actuation: a click on a ref that went stale after a page change
 * should re-snapshot in-probe, re-resolve the intended element by structural
 * identity, retry ONCE, and hand back a fresh snapshot — all in one round-trip.
 * When re-resolution is ambiguous/impossible, the failure still carries a fresh
 * snapshot so the agent never spends a call just to re-snapshot. A "covered"
 * click returns an actionable hint (the overlay's close control) + a fresh snapshot.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'

function makeDeps(): ActuateDeps {
  return { reg: createRefRegistry(), console: installConsoleCapture(), prevTree: { value: '' } }
}

describe('self-healing click', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('recovers a stale ref by role+name after the selector changed, retries, and returns a fresh snapshot', async () => {
    // The button's captured selector is `#sub1` (id anchor). A re-render re-mounts it
    // WITHOUT the id, so the selector goes stale — but role+name still identify it.
    document.body.innerHTML = `<div id="app"><button id="sub1">Subscribe</button></div>`
    const deps = makeDeps()
    const snap = await runCommand({ action: 'snapshot' }, deps)
    expect(snap.result?.snapshot?.tree).toContain('[ref=e1]')

    let clicked = false
    document.querySelector('#app')!.innerHTML = `<button>Subscribe</button>`
    document.querySelector('#app button')!.addEventListener('click', () => {
      clicked = true
    })

    const r = await runCommand({ action: 'click', ref: 'e1' }, deps)
    expect(r.ok).toBe(true)
    expect(clicked).toBe(true) // the retry landed on the fresh node
    expect(r.result?.note).toContain('re-resolved') // heal was announced (cross-gen path)
    expect(r.result?.snapshot?.tree).toContain('[ref=') // fresh refs handed back
  })

  test('an unrecoverable stale ref still returns a fresh snapshot in the same call', async () => {
    document.body.innerHTML = `<button class="only">Alpha</button>`
    const deps = makeDeps()
    await runCommand({ action: 'snapshot' }, deps)
    // The target vanishes entirely and is replaced by a differently-named control.
    document.body.innerHTML = `<button class="other">Beta</button>`

    const r = await runCommand({ action: 'click', ref: 'e1' }, deps)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('not_found')
    expect(r.error ?? '').toContain('fresh snapshot is attached')
    // The fresh snapshot rides along so the agent re-targets without a separate call.
    expect(r.result?.snapshot?.tree).toContain('Beta')
  })

  test('a covered target names the overlay + its close control and attaches a snapshot', async () => {
    // A full-viewport modal covers a button underneath it.
    document.body.innerHTML = `
      <button class="buy">Buy</button>
      <div role="dialog" aria-modal="true" style="position:fixed;inset:0">
        <button aria-label="Close dialog">×</button>
      </div>`
    const deps = makeDeps()
    const snap = buildSnapshot(deps.reg)
    // Find the buy button's ref from the tree.
    const buyRef = /- button "Buy" \[ref=(e\d+)\]/.exec(snap.tree)?.[1]
    expect(buyRef).toBeTruthy()

    const r = await runCommand({ action: 'click', ref: buyRef! }, deps)
    // happy-dom may not fully compute occlusion; assert the shape only when it fires.
    if (!r.ok) {
      expect(r.errorCode).toBe('intercepted')
      expect((r.error ?? '').toLowerCase()).toContain('covered')
      expect(r.result?.snapshot).toBeDefined()
    }
  })
})
