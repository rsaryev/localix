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
  const changes: (number | undefined)[] = []
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
      await React.act(async () => {
        if (button.disabled) return
        button.focus()
        button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
    },
    cleanup: async () => {
      await React.act(async () => {
        root.unmount()
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      host.remove()
    },
  }
}

describe('MaxTurnsControl', () => {
  test('opens explicit choices and can restore the inherited default', async () => {
    const ui = await render(undefined)
    const React = await import('react')
    try {
      expect(ui.host.textContent).toContain('No limit')
      expect(ui.button.getAttribute('aria-label')).toBe('Turns per message: No limit')
      await ui.click()
      const choice = Array.from(
        document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'),
      ).find((item) => item.textContent?.trim() === '20') as HTMLElement
      expect(choice).toBeTruthy()
      await React.act(async () => choice.click())
      expect(ui.changes).toEqual([20])
      expect(ui.host.textContent).toBe('20')
      await ui.click()
      const reset = Array.from(
        document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'),
      ).find((item) => item.textContent?.includes('Use default')) as HTMLElement
      await React.act(async () => reset.click())
      expect(ui.changes).toEqual([20, undefined])
      expect(ui.host.textContent).toContain('No limit')
    } finally {
      await ui.cleanup()
    }
  })

  test('keeps a custom stored limit visible without changing it on open', async () => {
    const ui = await render(7)
    try {
      expect(ui.host.textContent).toBe('7')
      await ui.click()
      expect(ui.changes).toEqual([])
      expect(document.querySelector('[role="menu"]')?.textContent).toContain('7')
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
      expect(document.querySelector('[role="menu"]')).toBeNull()
    } finally {
      await ui.cleanup()
    }
  })
})
