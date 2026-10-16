/**
 * A `steps` batch settles ONCE, at the end.
 *
 * Every step used to run the full post-action pass — wait for html/body transitions (up to
 * 400ms, in 50ms fallback frames in a background preview) and resample the tree for a diff
 * the batch then discarded. That cost about a second per key press: a 2048 game needed 27
 * batches to reach 1000 points, and two batches of 10+ presses hit the UI's 10s cap and came
 * back "the preview did not respond in time" although their moves had run.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

test('five presses in one batch run the full settle once, and every press still lands', async () => {
  document.body.innerHTML = '<p id="count">0</p>'
  let presses = 0
  const onKey = () => {
    document.getElementById('count')!.textContent = String(++presses)
  }
  document.addEventListener('keydown', onKey)
  let settles = 0
  const deps: ActuateDeps = {
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {
      settles++
    },
  }
  const result = await runCommand(
    {
      action: 'steps',
      steps: Array.from({ length: 5 }, () => ({ action: 'press', key: 'ArrowLeft' })),
    },
    deps,
  )
  document.removeEventListener('keydown', onKey)
  expect(result.ok).toBe(true)
  expect(presses).toBe(5)
  expect(settles).toBe(1)
})
