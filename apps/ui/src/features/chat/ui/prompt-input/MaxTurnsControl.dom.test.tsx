import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

async function render(value: number | undefined, disabled = false) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MaxTurnsControl } = await import('./MaxTurnsControl')
  const changes: number[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const paint = (current: number | undefined) =>
    root.render(
      React.createElement(MaxTurnsControl, {
        value: current,
        disabled,
        onChange: (next) => {
          changes.push(next)
          paint(next)
        },
      }),
    )
  await React.act(async () => paint(value))
  const button = host.querySelector('button')!
  return {
    host,
    button,
    changes,
    click: async () => {
      await React.act(async () => button.click())
    },
    cleanup: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('MaxTurnsControl', () => {
  test('an unset cap reads as no limit and announces the next preset', async () => {
    const ui = await render(undefined)
    try {
      expect(ui.host.textContent).toContain('∞')
      expect(ui.button.getAttribute('aria-label')).toBe(
        'Turns per message: no limit. Click to set 1',
      )
      expect(ui.button.hasAttribute('aria-haspopup')).toBe(false)
      expect(ui.changes).toEqual([])
      await ui.click()
      expect(ui.changes).toEqual([1])
      expect(ui.host.textContent).toBe('1')
      expect(document.querySelector('[role="menu"]')).toBeNull()
    } finally {
      await ui.cleanup()
    }
  })

  test('clicks advance through five presets and wrap back to one', async () => {
    const ui = await render(1)
    try {
      for (const label of ['5', '20', '100', '∞', '1']) {
        await ui.click()
        expect(ui.host.textContent).toBe(label)
      }
      expect(ui.changes).toEqual([5, 20, 100, 1000, 1])
    } finally {
      await ui.cleanup()
    }
  })

  test('a custom stored limit stays visible until a click advances it', async () => {
    const ui = await render(7)
    try {
      expect(ui.host.textContent).toBe('7')
      expect(ui.button.getAttribute('aria-label')).toBe('Turns per message: 7. Click to set 20')
      expect(ui.changes).toEqual([])
      await ui.click()
      expect(ui.changes).toEqual([20])
    } finally {
      await ui.cleanup()
    }
  })

  test('a disabled control cannot change the budget', async () => {
    const ui = await render(20, true)
    try {
      expect(ui.button.disabled).toBe(true)
      await ui.click()
      expect(ui.changes).toEqual([])
      expect(ui.host.textContent).toBe('20')
    } finally {
      await ui.cleanup()
    }
  })
})
