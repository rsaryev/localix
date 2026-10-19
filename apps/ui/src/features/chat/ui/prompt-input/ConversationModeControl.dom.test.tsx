import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ConversationMode } from '@localixai/api/conversation-modes'

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

async function mount(value: ConversationMode, canBeSolo = true) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ConversationModeControl } = await import('./ConversationModeControl')
  const changes: ConversationMode[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <ConversationModeControl
        value={value}
        canBeSolo={canBeSolo}
        onChange={(next) => changes.push(next)}
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

describe('ConversationModeControl — whether agents share the conversation', () => {
  test('the icon names the mode; the menu checks it and switches to the other', async () => {
    const ui = await mount('solo')
    try {
      // An icon like Add participant beside it, not a labelled pill: one figure is solo.
      expect(ui.trigger.textContent).toBe('')
      expect(ui.trigger.querySelector('.lucide-user')).not.toBeNull()
      expect(ui.trigger.getAttribute('aria-label')).toBe('Conversation mode: Solo. Change')
      await ui.open()
      expect(ui.item('Solo')?.getAttribute('aria-checked')).toBe('true')
      expect(ui.item('Group')?.textContent).toContain('hand work to each other')
      await ui.pick(ui.item('Group'))
      expect(ui.changes).toEqual(['group'])
    } finally {
      await ui.unmount()
    }
  })

  test('re-picking the current mode writes nothing', async () => {
    const ui = await mount('group')
    try {
      expect(ui.trigger.querySelector('.lucide-users')).not.toBeNull()
      await ui.open()
      await ui.pick(ui.item('Group'))
      expect(ui.changes).toEqual([])
    } finally {
      await ui.unmount()
    }
  })

  test('with several agents seated, solo says what to do instead of being offered', async () => {
    const ui = await mount('group', false)
    try {
      await ui.open()
      const solo = ui.item('Solo')
      expect(solo?.textContent).toContain('Remove the other participants first')
      expect(solo?.getAttribute('aria-disabled')).toBe('true')
      await ui.pick(solo)
      expect(ui.changes).toEqual([])
    } finally {
      await ui.unmount()
    }
  })
})
