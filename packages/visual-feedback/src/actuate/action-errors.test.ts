/**
 * A drive action now surfaces the page errors IT triggered on the SAME
 * result. (1) A click whose handler throws rides an uncaught-error line in
 * `recentErrors` (instead of a silent "(no visible change)"). (2) A native dialog
 * (alert/confirm/prompt) is auto-dismissed — non-blocking, so the probe bridge never
 * freezes — and recorded as a `[dialog] … auto-dismissed` line that rides recentErrors.
 *
 * happy-dom mirrors the browser here: a throwing click listener is caught and re-emitted
 * as a window `error` event (dispatchEvent does NOT re-throw), which the console capture
 * records — so the throw shows up in recentErrors without aborting the click.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { installDialogAutoDismiss } from './dialog-capture'
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
/** Snapshot + seed the diff baseline like a real snapshot round-trip would. */
function seed(deps: ActuateDeps): string {
  const ref = refInTree(buildSnapshot(deps.reg).tree)
  deps.prevTree.value = stateForDiff()
  return ref
}

describe('drive-action error capture (recentErrors)', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('a click whose handler THROWS carries the uncaught error on the result', async () => {
    document.body.innerHTML = `<button id="b">Save</button>`
    ;(document.querySelector('#b') as HTMLButtonElement).onclick = () => {
      throw new Error('cannot read value of null')
    }
    const deps = makeDeps()
    const ref = seed(deps)

    const r = await runCommand({ action: 'click', ref }, deps)
    // The click itself "succeeds" (the browser swallows the listener throw into a window
    // error event) — but the error rides recentErrors so it isn't a silent no-op.
    expect(r.ok).toBe(true)
    expect(
      (r.result?.recentErrors ?? []).some((e) => e.includes('cannot read value of null')),
    ).toBe(true)
  })

  test('a clean click carries no recentErrors', async () => {
    document.body.innerHTML = `<button id="b">Ok</button>`
    ;(document.querySelector('#b') as HTMLButtonElement).onclick = () => {
      /* well-behaved */
    }
    const deps = makeDeps()
    const ref = seed(deps)

    const r = await runCommand({ action: 'click', ref }, deps)
    expect(r.ok).toBe(true)
    expect(r.result?.recentErrors).toBeUndefined()
  })

  test('recentErrors is bounded to the 3 most recent entries', async () => {
    document.body.innerHTML = `<button id="b">Log</button>`
    ;(document.querySelector('#b') as HTMLButtonElement).onclick = () => {
      for (let i = 0; i < 6; i++) console.error(`err-${i}`)
    }
    const deps = makeDeps()
    const ref = seed(deps)

    const r = await runCommand({ action: 'click', ref }, deps)
    expect(r.result?.recentErrors).toEqual(['err-3', 'err-4', 'err-5']) // last 3 survive
  })

  test('recentErrors only reflects THIS action, not errors before it', async () => {
    document.body.innerHTML = `<button id="b">Quiet</button>`
    ;(document.querySelector('#b') as HTMLButtonElement).onclick = () => {
      /* quiet */
    }
    const deps = makeDeps()
    const ref = seed(deps)
    console.error('from a PRIOR turn') // logged before the click's cursor is captured

    const r = await runCommand({ action: 'click', ref }, deps)
    expect(r.result?.recentErrors).toBeUndefined() // the prior error is not attributed here
  })
})

describe('dialog auto-dismiss (installDialogAutoDismiss)', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('non-blocking stubs: alert→undefined, confirm→true, prompt→null, each recorded', () => {
    const cap = installConsoleCapture()
    const dialogs = installDialogAutoDismiss(cap)
    try {
      const c = cap.cursor()
      expect(window.alert('boom')).toBeUndefined()
      expect(window.confirm('sure?')).toBe(true)
      expect(window.prompt('name?')).toBeNull()
      const texts = cap.read(c).map((e) => e.text)
      expect(texts).toContain('[dialog] alert("boom") auto-dismissed')
      expect(texts).toContain('[dialog] confirm("sure?") auto-dismissed')
      expect(texts).toContain('[dialog] prompt("name?") auto-dismissed')
    } finally {
      dialogs.uninstall()
      cap.uninstall()
    }
  })

  test('an alert() fired during a click is auto-dismissed and rides recentErrors (no hang)', async () => {
    document.body.innerHTML = `<button id="b">Save</button>`
    ;(document.querySelector('#b') as HTMLButtonElement).onclick = () => {
      window.alert('Saved!')
    }

    const deps = makeDeps()
    const dialogs = installDialogAutoDismiss(deps.console)
    try {
      const ref = refInTree(buildSnapshot(deps.reg).tree)
      deps.prevTree.value = stateForDiff()
      // If alert still blocked, this await would never resolve → the test would time out.
      const r = await runCommand({ action: 'click', ref }, deps)
      expect(r.ok).toBe(true)
      expect(
        (r.result?.recentErrors ?? []).some((e) =>
          e.includes('[dialog] alert("Saved!") auto-dismissed'),
        ),
      ).toBe(true)
    } finally {
      dialogs.uninstall()
    }
  })

  test('truncates a very long dialog message', () => {
    const cap = installConsoleCapture()
    const dialogs = installDialogAutoDismiss(cap)
    try {
      const c = cap.cursor()
      window.alert('x'.repeat(1000))
      const line = cap
        .read(c)
        .map((e) => e.text)
        .find((t) => t.startsWith('[dialog] alert'))
      expect(line).toBeDefined()
      expect((line ?? '').length).toBeLessThan(260) // message capped ~200 + envelope
      expect(line).toContain('…')
    } finally {
      dialogs.uninstall()
      cap.uninstall()
    }
  })

  test('idempotent: a second install is a no-op and does not double-wrap', () => {
    const cap = installConsoleCapture()
    const first = installDialogAutoDismiss(cap)
    const patched = window.alert
    const second = installDialogAutoDismiss(cap) // already patched → skips
    try {
      expect(window.alert).toBe(patched) // unchanged by the second install
    } finally {
      second.uninstall()
      first.uninstall()
      cap.uninstall()
    }
  })

  test('uninstall restores the original dialog functions', () => {
    const cap = installConsoleCapture()
    const original = window.alert
    const dialogs = installDialogAutoDismiss(cap)
    expect(window.alert).not.toBe(original)
    dialogs.uninstall()
    expect(window.alert).toBe(original)
    cap.uninstall()
  })
})
