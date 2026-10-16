/**
 * A ref from a snapshot another renderer of the same tab took (the readiness snapshot folded
 * into `open`, then a screenshot answered by the remounted visible pane) used to fail with
 * `ref "e1" not found — the page changed` on a page that had not changed at all. A document
 * that never snapshotted numbers its refs on first use for a screenshot (it only looks); a drive
 * action keeps refusing, since after a reload the same number may name another control.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { createRefRegistry } from '../snapshot/index'
import { isFail, resolveTarget } from './target'

function makeDeps(): ActuateDeps {
  return { reg: createRefRegistry(), console: installConsoleCapture(), prevTree: { value: '' } }
}

describe('a ref named in a document that has not snapshotted yet', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('a screenshot resolves the element the other renderer numbered', async () => {
    document.body.innerHTML = `<main><h1>Board</h1><button id="go">New game</button></main>`
    const elsewhere = await runCommand({ action: 'snapshot' }, makeDeps())
    const line = elsewhere.result?.snapshot?.tree.split('\n').find((l) => l.includes('New game'))
    const ref = line?.match(/ref=(e\d+)/)?.[1]
    expect(ref).toBeDefined()

    // The screenshot path's resolution (rasterizing needs a real browser).
    const here = createRefRegistry()
    const el = resolveTarget({ action: 'screenshot', ref: ref! }, here, undefined, {
      observeOnly: true,
    })
    expect(el).toBe(document.querySelector('#go')!)
    // A drive action in a fresh document still refuses the same ref.
    const click = resolveTarget({ action: 'click', ref: ref! }, createRefRegistry())
    expect(isFail(click)).toBe(true)
  })

  test('a ref that does not exist still fails as not found', async () => {
    document.body.innerHTML = `<button>Only</button>`
    const result = resolveTarget(
      { action: 'screenshot', ref: 'e999' },
      createRefRegistry(),
      undefined,
      {
        observeOnly: true,
      },
    )
    expect(isFail(result) && result.errorCode).toBe('not_found')
  })
})
