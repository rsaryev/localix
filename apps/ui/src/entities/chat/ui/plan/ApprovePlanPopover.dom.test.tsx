import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ImplementationMode } from '@localixai/api/client'
import { turns as settle } from '@/testing/settle'

let teardown: () => Promise<void>
const cleanups: Array<() => unknown> = []

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/** The Approve menu over the plan of a conversation. */
async function render(recommended = false) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ApprovePlanPopover } = await import('./ApprovePlanPopover')
  const onApprove = mock(async (_mode: ImplementationMode) => true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(<ApprovePlanPopover version={3} onApprove={onApprove} recommended={recommended} />)
    await settle()
  })
  cleanups.push(async () => {
    await React.act(async () => root.unmount())
    host.remove()
  })
  const act = React.act
  const click = async (element: HTMLElement | undefined) => {
    expect(element).toBeDefined()
    await act(async () => {
      element!.click()
      await settle()
    })
  }
  /** The root menu panel (the first one; a submenu is its own panel). */
  const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]')
  /** A row on the main level, by its label: the submenu triggers and the Approve row. */
  const row = (name: string) =>
    [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(
      (element) => label(element) === name,
    )
  /** The choices of the submenu currently open. */
  const choices = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
  return {
    menu,
    row,
    choices,
    onApprove,
    open: async () => {
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Approve plan"]')!
      await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
    },
    /** Open `level`'s submenu and pick the choice labelled `name`. */
    pick: async (level: string, name: string) => {
      await click(row(level))
      await click(choices().find((element) => label(element) === name))
    },
    approve: () => click(row('Approve')),
    /** A row's value: its right-aligned hint, the last truncating span after the label. */
    value: (level: string) =>
      [...(row(level)?.querySelectorAll('.truncate') ?? [])].at(-1)?.textContent,
    click,
  }
}

/** A menu row's label — the first truncating span, past its icon (a monogram has letters). */
const label = (element: Element) => element.querySelector('.truncate')?.textContent

/** A choice's description line, if it has one. */
const description = (element: Element) =>
  element.querySelector('.flex-col > :last-child')?.textContent ?? null

describe('the approve menu', () => {
  test('opens on Default and approves', async () => {
    const view = await render()
    await view.open()
    expect(view.menu()!.textContent).toContain('Approve plan v3')
    expect(view.value('Mode')).toBe('Default')
    // The conversation has one agent: nobody to choose between.
    expect(view.row('Agent')).toBeUndefined()
    await view.approve()
    expect(view.onApprove).toHaveBeenCalledWith('default')
    // A recorded approval closes it.
    expect(view.menu()).toBeNull()
  })

  test('a recommended Approve carries the accent on its trigger AND on the Approve row', async () => {
    const view = await render(true)
    const trigger = document.body.querySelector('button[aria-label="Approve plan"]')!
    expect(trigger.querySelector('.lx-border-beam[data-surface="fill"]')).not.toBeNull()
    await view.open()
    expect(view.row('Approve')!.querySelector('.lx-border-beam')).not.toBeNull()
    expect(view.row('Mode')!.querySelector('.lx-border-beam')).toBeNull()
  })

  test('without the recommendation, neither the trigger nor the row is marked', async () => {
    const view = await render()
    await view.open()
    expect(document.body.querySelector('.lx-border-beam')).toBeNull()
  })

  test('the modes list like the composer menu: icon in its tone, what it means, a check', async () => {
    const view = await render()
    await view.open()
    await view.click(view.row('Mode'))
    const modes = view.choices()
    expect(modes.map(label)).toEqual(['Default', 'Bypass', 'Autonomous'])
    expect(modes.map((element) => element.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ])
    // Every mode keeps its icon — Autonomous included — in the tone the composer gives it.
    for (const element of modes) {
      expect(element.firstElementChild?.querySelector('svg')).not.toBeNull()
    }
    expect(modes[2]!.firstElementChild?.querySelector('svg')?.getAttribute('class')).toContain(
      'text-status-error',
    )
    expect(description(modes[1]!)).toContain('No permission prompts')
  })

  test('a pick keeps the menu open, steps back and shows on its row', async () => {
    const view = await render()
    await view.open()
    await view.pick('Mode', 'Bypass')
    // Back on the main level: the submenu is gone, the menu is not, the row says Bypass.
    expect(view.choices()).toHaveLength(0)
    expect(view.menu()).not.toBeNull()
    expect(view.value('Mode')).toBe('Bypass')
    await view.approve()
    expect(view.onApprove).toHaveBeenCalledWith('bypass')
  })
})
