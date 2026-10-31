/**
 * back / forward / reload: the page moves in its own session history, the way the person's
 * toolbar buttons do. The probe asks the page to go, nothing more: it cannot report the next
 * document (it is replaced), so the hosts answer with the page that followed. Navigation is
 * injected, so nothing here leaves the test page.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from './index'
import type { PageNavigation } from './navigate'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

function pageWith(history: { canGoBack?: boolean; canGoForward?: boolean }) {
  const calls: string[] = []
  const nav: PageNavigation = {
    canGoBack: () => history.canGoBack ?? true,
    canGoForward: () => history.canGoForward ?? true,
    back: () => calls.push('back'),
    forward: () => calls.push('forward'),
    reload: () => calls.push('reload'),
  }
  const deps: ActuateDeps = {
    reg: createRefRegistry(),
    console: installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {},
    nav,
  }
  return { calls, deps }
}

describe('page navigation', () => {
  test.each(['back', 'forward', 'reload'] as const)(
    '%s asks the page to go, once',
    async (action) => {
      const { calls, deps } = pageWith({})
      const r = await runCommand({ action }, deps)
      expect(r.ok).toBe(true)
      expect(r.result?.action).toBe(action)
      expect(calls).toEqual([action])
      expect(r.result?.note).toContain(action === 'reload' ? 'reload' : `went ${action}`)
    },
  )

  test('back at the start of the history says there is nowhere to go and does not navigate', async () => {
    const { calls, deps } = pageWith({ canGoBack: false })
    const r = await runCommand({ action: 'back' }, deps)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('no earlier page')
    expect(calls).toEqual([])
  })

  test('forward with nothing ahead is refused the same way', async () => {
    const { calls, deps } = pageWith({ canGoForward: false })
    const r = await runCommand({ action: 'forward' }, deps)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('no later page')
    expect(calls).toEqual([])
  })

  test('a reload needs no history', async () => {
    const { calls, deps } = pageWith({ canGoBack: false, canGoForward: false })
    expect((await runCommand({ action: 'reload' }, deps)).ok).toBe(true)
    expect(calls).toEqual(['reload'])
  })
})
