import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns as settle } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

async function mount(props: { value: 'low' | 'high' }) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ModelReasoningMenu } = await import('./ModelReasoningMenu')
  const changes: string[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <ModelReasoningMenu
        modelLabel="GPT-6 Luna"
        reasoningEfforts={['low', 'medium', 'high']}
        {...props}
        onChange={(effort) => changes.push(effort)}
      />,
    ),
  )
  const trigger = host.querySelector<HTMLButtonElement>('button')!
  return {
    trigger,
    changes,
    open: async () => {
      await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
    },
    item: (label: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')].find(
        (element) => element.textContent?.startsWith(label),
      ),
    pick: async (element: HTMLElement | undefined) => {
      expect(element).toBeDefined()
      await act(async () => {
        element!.click()
        await settle()
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('ModelReasoningMenu', () => {
  test('a quiet trigger names the level; the shared menu lists only what the model offers', async () => {
    const ui = await mount({ value: 'high' })
    try {
      expect(ui.trigger.getAttribute('aria-label')).toBe('Reasoning for GPT-6 Luna: High')
      await ui.open()
      // This model publishes no `off`: the runtime would send `low`, so Off is not offered.
      expect(ui.item('Off')).toBeUndefined()
      expect(ui.item('Minimal')).toBeUndefined()
      // One choice among levels: a radio row, its meaning set under the name rather than
      // squeezed into the right-aligned hint.
      expect(ui.item('High')?.getAttribute('role')).toBe('menuitemradio')
      expect(ui.item('High')?.getAttribute('aria-checked')).toBe('true')
      expect(ui.item('High')?.textContent).toContain('Deep reasoning')
      await ui.pick(ui.item('Low'))
      expect(ui.changes).toEqual(['low'])
    } finally {
      await ui.unmount()
    }
  })

  test('there is no inherited choice: the menu marks exactly the level the request carries', async () => {
    const ui = await mount({ value: 'low' })
    try {
      expect(ui.trigger.textContent).toBe('Low')
      await ui.open()
      expect(ui.item('Follow the conversation')).toBeUndefined()
      expect(ui.item('Low')?.getAttribute('aria-checked')).toBe('true')
    } finally {
      await ui.unmount()
    }
  })
})
