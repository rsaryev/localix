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

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

async function render(value: number | undefined) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MaxTurnsControl } = await import('./MaxTurnsControl')
  const changes: number[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(
      React.createElement(MaxTurnsControl, { value, onChange: (next) => changes.push(next) }),
    )
  })
  const button = host.querySelector('button')!
  const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
  return {
    host,
    button,
    changes,
    rows,
    row: (label: string) => rows().find((row) => row.textContent?.startsWith(label)),
    open: async () => {
      await React.act(async () => {
        button.focus()
        button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
    },
    pick: async (row: HTMLElement | undefined) => {
      expect(row).toBeDefined()
      await React.act(async () => {
        row!.click()
        await settle()
      })
    },
    cleanup: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('MaxTurnsControl — how many turns one message buys', () => {
  test('an unset cap reads as no limit, not as a number nobody can act on', async () => {
    // Printing the ceiling as "1000" invites the question of what happens on turn 1001. Nothing
    // does: the run ends when the agent stops working.
    const ui = await render(undefined)
    try {
      expect(ui.host.textContent).toContain('∞')
      expect(ui.button.getAttribute('aria-label')).toContain('no limit')
      await ui.open()
      const unlimited = ui.row('∞')
      expect(unlimited?.getAttribute('aria-checked')).toBe('true')
      expect(unlimited?.textContent).toContain('Runs until the agent stops')
    } finally {
      await ui.cleanup()
    }
  })

  test('opening the menu changes nothing; every step is one pick away', async () => {
    // The cycling button it replaced changed the setting on the press meant to look at it, and
    // going back down meant walking the whole scale through the wrap.
    const ui = await render(20)
    try {
      await ui.open()
      expect(ui.changes).toEqual([])
      expect(ui.rows()).toHaveLength(13)
      expect(ui.row('20')?.getAttribute('aria-checked')).toBe('true')
      await ui.pick(ui.row('12'))
      expect(ui.changes).toEqual([12])
    } finally {
      await ui.cleanup()
    }
  })

  test('re-picking the current step writes nothing', async () => {
    const ui = await render(20)
    try {
      await ui.open()
      await ui.pick(ui.row('20'))
      expect(ui.changes).toEqual([])
    } finally {
      await ui.cleanup()
    }
  })

  test('a value off the scale still shows as the current choice', async () => {
    // Nothing forces a stored setting onto the scale — a person may have typed 7.
    const ui = await render(7)
    try {
      await ui.open()
      expect(ui.row('7')?.getAttribute('aria-checked')).toBe('true')
      // In order on the scale, between the steps around it.
      const labels = ui.rows().map((row) => row.textContent)
      expect(labels.slice(3, 6)).toEqual(['5', '7', '8'])
    } finally {
      await ui.cleanup()
    }
  })
})
