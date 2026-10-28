import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ContextLimit } from '@localixai/agent'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

async function render(contextWindow: number, value: ContextLimit | undefined) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ContextLimitControl } = await import('./ContextLimitControl')
  const changes: (ContextLimit | undefined)[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const paint = (current: ContextLimit | undefined) =>
    root.render(
      React.createElement(ContextLimitControl, {
        contextWindow,
        value: current,
        onChange: (next) => {
          changes.push(next)
          paint(next)
        },
      }),
    )
  await React.act(async () => paint(value))
  const button = host.querySelector('button')!
  const items = () =>
    Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')).map(
      (item) => item as HTMLElement,
    )
  return {
    button,
    changes,
    items,
    open: async () => {
      await React.act(async () => {
        button.focus()
        button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await turns()
      })
    },
    pick: async (label: string) => {
      const item = items().find((row) => row.textContent?.trim() === label)!
      await React.act(async () => item.click())
    },
    cleanup: async () => {
      await React.act(async () => {
        root.unmount()
        await turns()
      })
      host.remove()
    },
  }
}

describe('ContextLimitControl', () => {
  test("offers the model's own ladder and writes the chosen step", async () => {
    const ui = await render(1_000_000, undefined)
    try {
      expect(ui.button.getAttribute('aria-label')).toBe('Context limit: Auto · 272k')
      await ui.open()
      expect(ui.items().map((item) => item.textContent?.trim())).toEqual([
        'Auto · 272k',
        '128k',
        '200k',
        '400k',
        '600k',
        'Full · 900k',
      ])
      await ui.pick('600k')
      expect(ui.changes).toEqual([600_000])
      expect(ui.button.getAttribute('aria-label')).toBe('Context limit: 600k')
    } finally {
      await ui.cleanup()
    }
  })

  test('Auto clears the stored limit; a step from a bigger model reads as what it gives', async () => {
    const ui = await render(400_000, 2_000_000)
    try {
      expect(ui.button.getAttribute('aria-label')).toBe('Context limit: Full · 360k')
      await ui.open()
      await ui.pick('Auto · 272k')
      expect(ui.changes).toEqual([undefined])
    } finally {
      await ui.cleanup()
    }
  })
})
