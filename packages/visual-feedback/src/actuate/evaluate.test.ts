import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { createRefRegistry } from '../snapshot/index'

function makeDeps(): ActuateDeps {
  return { reg: createRefRegistry(), console: installConsoleCapture(), prevTree: { value: '' } }
}

describe('evaluate action', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('evaluates a plain expression', async () => {
    const r = await runCommand({ action: 'evaluate', expression: '1 + 2' }, makeDeps())
    expect(r.ok).toBe(true)
    expect(r.result?.value).toBe('3')
  })

  test('reads page DOM the a11y snapshot omits (text content)', async () => {
    document.body.innerHTML = '<div id="score">12345</div>'
    const r = await runCommand(
      { action: 'evaluate', expression: "document.querySelector('#score').textContent" },
      makeDeps(),
    )
    expect(r.result?.value).toBe('12345')
  })

  test('reads a page global and JSON-serializes objects', async () => {
    ;(globalThis as unknown as { __board: unknown }).__board = [
      [2, 0],
      [0, 4],
    ]
    const r = await runCommand({ action: 'evaluate', expression: '__board' }, makeDeps())
    expect(r.ok).toBe(true)
    expect(JSON.parse(r.result!.value!)).toEqual([
      [2, 0],
      [0, 4],
    ])
  })

  test('awaits a Promise result', async () => {
    const r = await runCommand({ action: 'evaluate', expression: 'Promise.resolve(7)' }, makeDeps())
    expect(r.result?.value).toBe('7')
  })

  test('falls back to a statement body when the expression form is a SyntaxError', async () => {
    const r = await runCommand(
      { action: 'evaluate', expression: 'const x = 41; return x + 1;' },
      makeDeps(),
    )
    expect(r.ok).toBe(true)
    expect(r.result?.value).toBe('42')
  })

  test('serializes a DOM element as tag + text, not {}', async () => {
    document.body.innerHTML = '<button id="go">Play</button>'
    const r = await runCommand(
      { action: 'evaluate', expression: "document.querySelector('#go')" },
      makeDeps(),
    )
    expect(r.result?.value).toContain('<button>')
    expect(r.result?.value).toContain('Play')
  })

  test('a thrown expression fails (not ok) with the error text', async () => {
    const r = await runCommand(
      { action: 'evaluate', expression: "throw new Error('boom')" },
      makeDeps(),
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
  })

  test('multi-statement: call a page global then read the result (theme pattern)', async () => {
    document.body.removeAttribute('data-theme')
    ;(globalThis as unknown as { toggleTheme?: () => void }).toggleTheme = () => {
      document.body.setAttribute('data-theme', 'light')
    }
    const r = await runCommand(
      { action: 'evaluate', expression: "toggleTheme(); document.body.getAttribute('data-theme')" },
      makeDeps(),
    )
    expect(r.ok).toBe(true)
    expect(r.result?.value).toBe('light') // completion value, not "undefined"
    expect(document.body.getAttribute('data-theme')).toBe('light') // the call really ran
  })

  test('a runtime throw in a multi-statement snippet surfaces (no silent undefined, no double-run)', async () => {
    let calls = 0
    ;(globalThis as unknown as { __boom?: () => void }).__boom = () => {
      calls += 1
      throw new Error('kaboom')
    }
    const r = await runCommand({ action: 'evaluate', expression: '__boom(); 1 + 1' }, makeDeps())
    expect(r.ok).toBe(false)
    expect(r.error).toContain('evaluate threw')
    expect(r.error).toContain('kaboom')
    expect(calls).toBe(1) // eval ran it once; the statement-body fallback did NOT re-run it
  })

  test('missing expression is a bad_request', async () => {
    const r = await runCommand({ action: 'evaluate' }, makeDeps())
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('bad_request')
  })

  test('undefined result serializes to the string "undefined"', async () => {
    const r = await runCommand({ action: 'evaluate', expression: 'void 0' }, makeDeps())
    expect(r.result?.value).toBe('undefined')
  })

  test('caps an oversized result', async () => {
    const r = await runCommand({ action: 'evaluate', expression: "'x'.repeat(50000)" }, makeDeps())
    expect(r.ok).toBe(true)
    expect(r.result!.value!).toContain('[truncated')
    expect(r.result!.value!.length).toBeLessThan(20000)
  })

  test('settles BEFORE reading so a queued async mutation is flushed first', async () => {
    document.documentElement.setAttribute('data-theme', 'light')
    // Model an async framework commit applied only when the page settles (like React
    // flushing setState→useEffect a microtask + rAF after a click). Inject a settle that
    // performs that flush: the evaluate must settle FIRST, then read 'dark' — not the
    // pre-settle 'light' a synchronous read (the pre-fix behavior) would return. This is
    // the "lone post-click evaluate read the OLD value" half of the original report.
    let settled = false
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle: async () => {
        document.documentElement.setAttribute('data-theme', 'dark')
        settled = true
      },
    }
    const r = await runCommand(
      { action: 'evaluate', expression: "document.documentElement.getAttribute('data-theme')" },
      deps,
    )
    expect(r.ok).toBe(true)
    expect(settled).toBe(true) // the settle ran as part of the evaluate action
    expect(r.result?.value).toBe('dark') // read the SETTLED value, not the pre-settle 'light'
    document.documentElement.removeAttribute('data-theme')
  })
})
