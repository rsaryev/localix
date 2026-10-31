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

function pageWith(_history: Record<string, never>) {
  const calls: string[] = []
  const nav: PageNavigation = {
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
      expect(r.result?.note).toContain(action === 'reload' ? 'reload' : `go ${action}`)
    },
  )

  test('back asks the browser even when the Navigation API sees no earlier entry of this origin', async () => {
    // After site1 -> site2 the API counts only same-origin entries: canGoBack is false while the
    // tab can still go back. The probe must not refuse on that; the host judges the move.
    const asked: string[] = []
    const win = window as unknown as { navigation?: unknown }
    const realBack = window.history.back.bind(window.history)
    win.navigation = { canGoBack: false, canGoForward: false }
    window.history.back = () => void asked.push('back')
    window.history.forward = () => void asked.push('forward')
    try {
      const deps: ActuateDeps = {
        reg: createRefRegistry(),
        console: installConsoleCapture(),
        prevTree: { value: '' },
        settle: async () => {},
      }
      expect((await runCommand({ action: 'back' }, deps)).ok).toBe(true)
      expect((await runCommand({ action: 'forward' }, deps)).ok).toBe(true)
      expect(asked).toEqual(['back', 'forward'])
    } finally {
      delete win.navigation
      window.history.back = realBack
    }
  })

  test('without the Navigation API the reply does not claim the move happened', async () => {
    const { deps } = pageWith({})
    const r = await runCommand({ action: 'back' }, deps)
    expect(r.result?.note).toContain('asked the tab to go back')
    expect(r.result?.note).toContain('if the page did not change')
  })

  test('a reload needs no history', async () => {
    const { calls, deps } = pageWith({})
    expect((await runCommand({ action: 'reload' }, deps)).ok).toBe(true)
    expect(calls).toEqual(['reload'])
  })
})
