import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

describe('chat status bar interactions', () => {
  test('opens timing details and dismisses them with Escape', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { StatusBar } = await import('./StatusBar')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <StatusBar
            sessionTiming={{
              totalMs: 2_000,
              modelMs: 900,
              revealMs: 100,
              toolGenMs: 200,
              waitMs: 300,
              toolMs: 400,
              hitlMs: 50,
              idleMs: 50,
              turns: 2,
              runs: 1,
            }}
          />,
        )
      })

      const trigger = host.querySelector<HTMLButtonElement>('[title="Session timing"]')
      expect(trigger).not.toBeNull()
      if (!trigger) return

      await act(async () => trigger.click())
      expect(trigger.getAttribute('data-state')).toBe('open')
      expect(document.body.textContent).toContain('Model (real)')
      expect(document.body.textContent).toContain('2 turns · 1 run')

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(trigger.getAttribute('data-state')).toBe('closed')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
