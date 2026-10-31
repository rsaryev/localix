/**
 * Regression (act-then-verify batches): the agent tried
 * `steps:[{click e9},{evaluate 'data-theme'}]` to click a toggle and read the result
 * in one call. The probe's step dispatcher already runs every step generically, so the
 * evaluate RAN — but its value was dropped from the batch note (only interactions carry
 * a `note`), so the agent never saw what it asked for. Surface the read-action output
 * (evaluate value / console tail) in the batch note.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'

describe('steps batch surfaces read-action output', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('a click-then-evaluate batch runs both and returns the evaluate value', async () => {
    document.documentElement.setAttribute('data-theme', 'light')
    document.body.innerHTML = '<button id="t">Toggle</button>'
    ;(document.querySelector('#t') as HTMLButtonElement).onclick = () => {
      document.documentElement.setAttribute('data-theme', 'dark')
    }
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle: async () => {},
    }
    const ref = /\[ref=(e\d+)\]/.exec(buildSnapshot(deps.reg).tree)![1]

    const r = await runCommand(
      {
        action: 'steps',
        steps: [
          { action: 'click', ref },
          { action: 'evaluate', expression: "document.documentElement.getAttribute('data-theme')" },
        ],
      },
      deps,
    )

    expect(r.ok).toBe(true)
    // The click ran (theme flipped) AND the evaluate's value is surfaced in the note —
    // the agent can act then verify in a single round-trip.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    const note = r.result?.note ?? ''
    expect(note).toContain('evaluate →')
    expect(note).toContain('dark')
  })

  test('a console step surfaces the last console entry in the batch note', async () => {
    document.body.innerHTML = '<button id="t">Log</button>'
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle: async () => {},
    }
    const ref = /\[ref=(e\d+)\]/.exec(buildSnapshot(deps.reg).tree)![1]
    ;(document.querySelector('#t') as HTMLButtonElement).onclick = () => {
      console.log('button pressed')
    }

    const r = await runCommand(
      {
        action: 'steps',
        steps: [{ action: 'click', ref }, { action: 'console' }],
      },
      deps,
    )

    expect(r.ok).toBe(true)
    expect(r.result?.note ?? '').toContain('console →')
    expect(r.result?.note ?? '').toContain('button pressed')
  })

  test('a batch answers with the rect of the last control it clicked or typed into', async () => {
    document.body.innerHTML = '<button id="go">Go</button><input id="q" aria-label="Query">'
    const place = (id: string, rect: DOMRect) =>
      (document.getElementById(id)!.getBoundingClientRect = () => rect)
    place('go', new DOMRect(10, 20, 100, 30))
    place('q', new DOMRect(40, 60, 200, 24))
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle: async () => {},
    }
    buildSnapshot(deps.reg)
    const click = await runCommand(
      { action: 'steps', steps: [{ action: 'click', selector: '#go' }, { action: 'snapshot' }] },
      deps,
    )
    expect(click.result?.rect).toEqual({ x: 10, y: 20, width: 100, height: 30 })
    const both = await runCommand(
      {
        action: 'steps',
        steps: [
          { action: 'click', selector: '#go' },
          { action: 'type', selector: '#q', text: 'hi' },
          { action: 'snapshot' },
        ],
      },
      deps,
    )
    expect(both.result?.rect).toEqual({ x: 40, y: 60, width: 200, height: 24 })
    const none = await runCommand({ action: 'steps', steps: [{ action: 'snapshot' }] }, deps)
    expect(none.result?.rect).toBeUndefined()
  })
})
