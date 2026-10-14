import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

async function mount(props: { value: 'low' | 'high' | undefined; inheritedEffort?: 'medium' }) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ModelReasoningMenu } = await import('./ModelReasoningMenu')
  const changes: Array<string | undefined> = []
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
      expect(ui.trigger.className).not.toContain('border')
      await ui.open()
      expect(ui.item('Off')).toBeDefined()
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

  test('following the conversation is its own selected choice, and the way back to it', async () => {
    const following = await mount({ value: undefined, inheritedEffort: 'medium' })
    try {
      expect(following.trigger.textContent).toContain('Session · Medium')
      await following.open()
      const follow = following.item('Follow the conversation')
      expect(follow?.getAttribute('aria-checked')).toBe('true')
      // Its hint is the level it resolves to, in the same words the chip's menu uses.
      expect(follow?.textContent).toContain('Medium')
      // While it follows, no level claims the check: the choice is "none of my own".
      expect(following.item('Medium')?.getAttribute('aria-checked')).toBe('false')
    } finally {
      await following.unmount()
    }

    const own = await mount({ value: 'high', inheritedEffort: 'medium' })
    try {
      await own.open()
      await own.pick(own.item('Follow the conversation'))
      expect(own.changes).toEqual([undefined])
    } finally {
      await own.unmount()
    }
  })
})
