import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ImplementationMode } from '@localixai/api/client'
import type { PermissionMode } from '@localixai/api/permission-modes'

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

async function mount(value: PermissionMode, editable = true, waitingPlan?: { version: number }) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { PermissionModeControl } = await import('./PermissionModeControl')
  const changes: PermissionMode[] = []
  const approvals: ImplementationMode[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <PermissionModeControl
        value={value}
        editable={editable}
        onChange={(next) => changes.push(next)}
        waitingPlan={waitingPlan}
        onApprovePlan={(mode) => approvals.push(mode)}
      />,
    ),
  )
  const trigger = host.querySelector<HTMLButtonElement>('button')!
  return {
    trigger,
    changes,
    approvals,
    /** Open a mode's level the way a keyboard does: focus its row, then ArrowRight. */
    expand: async (element: HTMLElement | undefined) => {
      expect(element).toBeDefined()
      await act(async () => {
        element!.focus()
        element!.dispatchEvent(
          new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
        )
        await settle()
      })
    },
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

describe('PermissionModeControl — whether the agent stops to ask', () => {
  test('the trigger names the mode; the menu lists all four and checks the current one', async () => {
    const ui = await mount('default')
    try {
      expect(ui.trigger.getAttribute('aria-label')).toBe('Permission mode: Default. Change')
      await ui.open()
      for (const label of ['Default', 'Plan', 'Bypass', 'Autonomous']) {
        expect(ui.item(label)).toBeDefined()
      }
      expect(ui.item('Default')?.getAttribute('aria-checked')).toBe('true')
      // A choice among four, not a toggle: every row keeps its mode icon in front.
      for (const label of ['Default', 'Plan', 'Bypass', 'Autonomous']) {
        expect(ui.item(label)?.getAttribute('role')).toBe('menuitemradio')
        expect(ui.item(label)?.firstElementChild?.querySelector('svg')).not.toBeNull()
      }
      expect(
        ui.item('Autonomous')?.firstElementChild?.querySelector('svg')?.getAttribute('class'),
      ).toContain('text-status-error')
      await ui.pick(ui.item('Plan'))
      expect(ui.changes).toEqual(['plan'])
    } finally {
      await ui.unmount()
    }
  })

  test('opening the menu changes nothing, and re-picking the current mode writes nothing', async () => {
    // The cycling button it replaced changed the mode on the press meant to look at the options.
    const ui = await mount('bypass')
    try {
      await ui.open()
      expect(ui.changes).toEqual([])
      await ui.pick(ui.item('Bypass'))
      expect(ui.changes).toEqual([])
    } finally {
      await ui.unmount()
    }
  })

  test('the pill names the current mode beside its icon', async () => {
    const ui = await mount('plan')
    try {
      expect(ui.trigger.textContent).toBe('Plan')
      expect(ui.trigger.getAttribute('data-slot')).toBe('composer-chip')
      expect(ui.trigger.querySelector('svg')).not.toBeNull()
      expect(ui.trigger.querySelector('.lucide-chevron-down')).not.toBeNull()
      expect(ui.trigger.getAttribute('aria-label')).toBe('Permission mode: Plan. Change')
    } finally {
      await ui.unmount()
    }
  })

  test('with a plan waiting, leaving Plan mode asks: approve it in that mode', async () => {
    // The defect: picking Default meant "start the work", but it set plan v2 aside in silence
    // and took the Approve button with it.
    const ui = await mount('plan', true, { version: 2 })
    try {
      await ui.open()
      const bypass = ui.item('Bypass')
      expect(bypass?.getAttribute('aria-haspopup')).toBe('menu')
      // The mode's own sentence stays under its name while it opens a level.
      expect(bypass?.textContent).toContain('No permission prompts')
      await ui.expand(bypass)
      expect(ui.item('Leave Plan mode and set the plan aside')).toBeDefined()
      await ui.pick(ui.item('Approve plan v2 and implement in Bypass'))
      expect(ui.approvals).toEqual(['bypass'])
      expect(ui.changes).toEqual([])
    } finally {
      await ui.unmount()
    }
  })

  test('with a plan waiting, leaving Plan mode asks: or set the plan aside', async () => {
    const ui = await mount('plan', true, { version: 2 })
    try {
      await ui.open()
      // Plan itself is still the checked choice, not a level.
      expect(ui.item('Plan')?.getAttribute('aria-checked')).toBe('true')
      await ui.expand(ui.item('Default'))
      await ui.pick(ui.item('Leave Plan mode and set the plan aside'))
      expect(ui.changes).toEqual(['default'])
      expect(ui.approvals).toEqual([])
    } finally {
      await ui.unmount()
    }
  })

  test('without a waiting plan every mode is one plain choice', async () => {
    const ui = await mount('plan')
    try {
      await ui.open()
      expect(ui.item('Default')?.getAttribute('aria-haspopup')).toBeNull()
      await ui.pick(ui.item('Default'))
      expect(ui.changes).toEqual(['default'])
    } finally {
      await ui.unmount()
    }
  })

  test('a delegated child shows its root mode and cannot open the menu', async () => {
    const ui = await mount('plan', false)
    try {
      expect(ui.trigger.disabled).toBe(true)
      expect(ui.trigger.getAttribute('aria-label')).toContain('set by the conversation')
    } finally {
      await ui.unmount()
    }
  })
})
