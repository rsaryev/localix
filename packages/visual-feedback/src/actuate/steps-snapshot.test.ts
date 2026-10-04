/**
 * Regression (act-then-OBSERVE batches): the agent's natural follow-up
 * to an action is a snapshot, so it reached for `steps:[{click…},{snapshot}]`. `snapshot`
 * was not an allowed step action, so the whole call was rejected (3 wasted turns in
 * session 788). It IS now a step: the probe's step dispatcher already routes each step
 * through the generic `dispatch`, and a trailing `snapshot` step's fresh tree is carried
 * out on the batch result — so click-then-observe completes in ONE round-trip.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'

describe('steps batch supports a snapshot step', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('a click-then-snapshot batch runs both and returns the FRESH tree in one call', async () => {
    document.body.innerHTML = '<button id="add">Add</button><div id="host"></div>'
    ;(document.querySelector('#add') as HTMLButtonElement).onclick = () => {
      const b = document.createElement('button')
      b.textContent = 'Saved'
      document.querySelector('#host')!.appendChild(b)
    }
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle: async () => {},
    }
    // Seed refs; the first (only) interactive node is the Add button.
    const before = buildSnapshot(deps.reg)
    const ref = /\[ref=(e\d+)\]/.exec(before.tree)![1]
    expect(before.tree).not.toContain('Saved') // not there yet — proves the tree below is fresh

    const r = await runCommand(
      {
        action: 'steps',
        steps: [{ action: 'click', ref }, { action: 'snapshot' }],
      },
      deps,
    )

    expect(r.ok).toBe(true)
    // The click ran (a new button was appended)…
    expect(document.querySelectorAll('button')).toHaveLength(2)
    // …AND the batch carries a FRESH snapshot tree reflecting the post-click page —
    // the agent acts then observes in a single round-trip, no separate snapshot turn.
    expect(r.result?.snapshot).toBeDefined()
    expect(r.result?.snapshot?.tree).toContain('Saved')
    // The snapshot step's note reports the counts (a read step's output isn't dropped).
    expect(r.result?.note ?? '').toContain('snapshot →')
  })

  test('a lone snapshot step returns the tree (the read still runs inside a batch)', async () => {
    document.body.innerHTML = '<button>Hi</button>'
    const deps: ActuateDeps = {
      reg: createRefRegistry(),
      console: installConsoleCapture(),
      prevTree: { value: '' },
      settle: async () => {},
    }
    const r = await runCommand({ action: 'steps', steps: [{ action: 'snapshot' }] }, deps)
    expect(r.ok).toBe(true)
    expect(r.result?.snapshot?.stats.nodes).toBeGreaterThan(0)
    expect(r.result?.snapshot?.tree).toContain('button')
  })
})
