/**
 * A key that changes only a short text — a 2048 move changes the score, no control — must not be
 * reported as "(no visible change)": the agent read a working move as a dead one.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { stateForDiff } from './diff'
import { runCommand, installConsoleCapture, type ActuateDeps } from './index'
import { createRefRegistry } from '../snapshot/index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

test('a key that only changes the score reports the score', async () => {
  document.body.innerHTML = '<h1>2048</h1><div>Score</div><div id="score">0</div>'
  const onKey = (event: KeyboardEvent) => {
    if (event.code === 'ArrowLeft') document.getElementById('score')!.textContent = '28'
  }
  window.addEventListener('keydown', onKey)
  const deps: ActuateDeps = {
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {},
  }
  try {
    deps.prevTree.value = stateForDiff()
    const result = await runCommand({ action: 'press', key: 'ArrowLeft' }, deps)
    expect(result.result?.diff).toContain('- text "0"')
    expect(result.result?.diff).toContain('+ text "28"')
  } finally {
    window.removeEventListener('keydown', onKey)
    deps.console.uninstall()
  }
})
