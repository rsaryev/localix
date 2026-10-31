/**
 * The `wait` step: hold a batch until text or an element shows up (or goes away) in the page,
 * so a page that renders late is read AFTER it rendered instead of before. Time is injected:
 * the fake `sleep` moves the clock and lets the "page" change, so nothing here really waits.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())
beforeEach(() => {
  document.body.innerHTML = '<main id="app">Loading…</main>'
})

/** A clock the page's own "later" hangs off: `at` runs once the clock passes that time. */
function fakeTime(events: Record<number, () => void> = {}) {
  let t = 0
  const pending = Object.entries(events).map(([at, run]) => ({ at: Number(at), run, done: false }))
  const sleeps: number[] = []
  return {
    sleeps,
    clock: {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        t += ms
        for (const event of pending)
          if (!event.done && t >= event.at) {
            event.done = true
            event.run()
          }
      },
    },
  }
}

function depsWith(clock: ActuateDeps['clock']): ActuateDeps {
  return {
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {},
    clock,
  }
}

const wait = (step: Record<string, unknown>) =>
  ({ action: 'steps', steps: [{ action: 'wait', ...step }] }) as never

describe('wait step', () => {
  test('text that arrives later: the reply says when it appeared', async () => {
    const { clock } = fakeTime({ 300: () => (document.body.innerHTML = '<p>3 results found</p>') })
    const r = await runCommand(wait({ text: 'results found' }), depsWith(clock))
    expect(r.ok).toBe(true)
    expect(r.result?.note).toContain('"results found" appeared after 0.3s')
  })

  test('a selector that arrives later', async () => {
    const { clock } = fakeTime({
      1200: () => document.body.insertAdjacentHTML('beforeend', '<ul class="hits"></ul>'),
    })
    const r = await runCommand(wait({ selector: 'ul.hits' }), depsWith(clock))
    expect(r.ok).toBe(true)
    expect(r.result?.note).toContain('"ul.hits" appeared after 1.2s')
  })

  test('gone: waits for a spinner to leave, by selector and by text', async () => {
    document.body.innerHTML = '<div class="spinner">Please wait</div>'
    const removeSpinner = () => document.querySelector('.spinner')?.remove()
    const bySelector = fakeTime({ 500: removeSpinner })
    const a = await runCommand(
      wait({ selector: '.spinner', gone: true }),
      depsWith(bySelector.clock),
    )
    expect(a.result?.note).toContain('".spinner" gone after 0.5s')

    document.body.innerHTML = '<div class="spinner">Please wait</div>'
    const byText = fakeTime({ 200: removeSpinner })
    const b = await runCommand(wait({ text: 'Please wait', gone: true }), depsWith(byText.clock))
    expect(b.result?.note).toContain('"Please wait" gone after 0.2s')
  })

  test('what is already there answers at once, without a single sleep', async () => {
    document.body.innerHTML = '<p>Ready</p>'
    const { clock, sleeps } = fakeTime()
    const r = await runCommand(wait({ text: 'Ready' }), depsWith(clock))
    expect(r.result?.note).toContain('"Ready" was already there')
    expect(sleeps).toEqual([])
  })

  test('never appearing fails the step with the limit and a hint that the page may still be working', async () => {
    const { clock } = fakeTime()
    const r = await runCommand(wait({ text: 'Done' }), depsWith(clock))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('step 1 (wait)')
    expect(r.error).toContain('"Done" did not appear within 10s')
    expect(r.error).toContain('the page may still be working')
  })

  test('timeout_ms is honoured and capped at 15 s', async () => {
    const short = await runCommand(wait({ text: 'x', timeoutMs: 2000 }), depsWith(fakeTime().clock))
    expect(short.error).toContain('within 2s')
    const long = await runCommand(
      wait({ text: 'x', timeoutMs: 90_000 }),
      depsWith(fakeTime().clock),
    )
    expect(long.error).toContain('within 15s')
  })

  test('a failed wait stops the batch and says what already ran', async () => {
    const clicked: string[] = []
    document.body.innerHTML = '<button id="go">Go</button>'
    document.getElementById('go')!.onclick = () => clicked.push('go')
    const r = await runCommand(
      {
        action: 'steps',
        steps: [
          { action: 'click', selector: '#go' },
          { action: 'wait', text: 'Saved', timeoutMs: 1000 },
          { action: 'click', selector: '#go' },
        ],
      },
      depsWith(fakeTime().clock),
    )
    expect(r.ok).toBe(false)
    expect(clicked).toEqual(['go'])
    expect(r.error).toContain('step 2 (wait)')
    expect(r.error).toContain('do NOT repeat them')
  })

  test('needs exactly one of text or selector, and a valid selector', async () => {
    const d = () => depsWith(fakeTime().clock)
    expect((await runCommand(wait({}), d())).errorCode).toBe('bad_request')
    expect((await runCommand(wait({ text: 'a', selector: 'b' }), d())).errorCode).toBe(
      'bad_request',
    )
    const bad = await runCommand(wait({ selector: '##' }), d())
    expect(bad.errorCode).toBe('bad_request')
    expect(bad.error).toContain('invalid selector')
  })

  test('without an injected clock it polls on native timers, which a hidden tab still fires', async () => {
    // rAF never fires here, as in a background tab; the wait must not depend on it.
    const raf = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (() => 0) as typeof raf
    document.body.innerHTML = '<p>Ready</p>'
    const r = await runCommand(wait({ text: 'Ready' }), depsWith(undefined))
    globalThis.requestAnimationFrame = raf
    expect(r.ok).toBe(true)
  })
})
