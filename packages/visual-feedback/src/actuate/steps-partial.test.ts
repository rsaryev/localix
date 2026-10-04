/**
 * A `steps` batch stops at the first failing step — but the earlier steps ALREADY RAN,
 * and they mutate the page. The error used to report only "step 3 (click): …", so the
 * model's natural repair was to re-send the whole batch, typing and clicking twice.
 *
 * Same rule the bash `commands[]` batch follows: a partial execution must disclose what
 * it already did.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { buildSnapshot, createRefRegistry } from '../snapshot/index'

describe('steps batch discloses the steps that already ran', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  const deps = (): ActuateDeps => ({
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {},
  })

  test('a failure after a successful step names what already happened', async () => {
    document.body.innerHTML = '<input id="name" /><button id="go">Go</button>'
    const d = deps()
    buildSnapshot(d.reg) // seed refs
    const ref = /\[ref=(e\d+)\]/.exec(buildSnapshot(d.reg).tree)![1]

    const r = await runCommand(
      {
        action: 'steps',
        // Step 1 targets a real ref; step 2 targets a ref that does not exist.
        steps: [
          { action: 'type', ref, text: 'Ada' },
          { action: 'click', ref: 'e999' },
        ],
      },
      d,
    )

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('step 2 (click)')
    expect(r.error).toContain('Steps 1-1 already ran')
    expect(r.error).toContain('do NOT repeat them')
  })

  test('a failure on the FIRST step adds no already-ran notice', async () => {
    document.body.innerHTML = '<button id="go">Go</button>'
    const d = deps()
    buildSnapshot(d.reg)

    const r = await runCommand({ action: 'steps', steps: [{ action: 'click', ref: 'e999' }] }, d)

    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('step 1 (click)')
    expect(r.error).not.toContain('already ran')
  })
})
