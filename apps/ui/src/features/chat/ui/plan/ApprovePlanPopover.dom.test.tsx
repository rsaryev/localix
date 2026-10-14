import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ImplementationMode } from '@localixai/api/client'
import type { UiSession } from '@/shared/api/contracts'

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const member = (handle: string) => ({ agentId: `builtin:${handle}`, handle })

/** The Approve menu over a conversation with these participants; the plan's author is `@lead`. */
async function render(handles: readonly string[], recommended = false) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useChatStore } = await import('../../model/store')
  await React.act(async () => {
    useChatStore.setState({
      allSessions: [
        { id: 's1', agents: handles.map(member), rootSessionId: null } as unknown as UiSession,
      ],
    })
  })
  const { ApprovePlanPopover } = await import('./ApprovePlanPopover')
  const onApprove = mock(async (_mode: ImplementationMode, _to?: string) => true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(
      <ApprovePlanPopover
        ownerId="s1"
        author={{ agentId: 'builtin:lead' }}
        version={3}
        onApprove={onApprove}
        recommended={recommended}
      />,
    )
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
  test('opens on Default and Any agent and approves naming nobody', async () => {
    const view = await render(['qa', 'lead', 'backend'])
    await view.open()
    expect(view.menu()!.textContent).toContain('Approve plan v3')
    expect(view.value('Mode')).toBe('Default')
    expect(view.value('Agent')).toBe('Any agent')
    await view.approve()
    // No `to`: the conversation's strategy picks who answers, as for a message with no @.
    expect(view.onApprove).toHaveBeenCalledWith('default', undefined)
    // A recorded approval closes it.
    expect(view.menu()).toBeNull()
  })

  test('a recommended Approve carries the accent on its trigger AND on the Approve row', async () => {
    const view = await render(['lead'], true)
    const trigger = document.body.querySelector('button[aria-label="Approve plan"]')!
    expect(trigger.querySelector('.lx-border-beam[data-surface="fill"]')).not.toBeNull()
    await view.open()
    expect(view.row('Approve')!.querySelector('.lx-border-beam')).not.toBeNull()
    expect(view.row('Mode')!.querySelector('.lx-border-beam')).toBeNull()
  })

  test('without the recommendation, neither the trigger nor the row is marked', async () => {
    const view = await render(['lead'])
    await view.open()
    expect(document.body.querySelector('.lx-border-beam')).toBeNull()
  })

  test('the modes list like the composer menu: icon in its tone, what it means, a check', async () => {
    const view = await render(['lead'])
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
    const view = await render(['lead', 'backend', 'qa'])
    await view.open()
    await view.pick('Mode', 'Bypass')
    // Back on the main level: the submenu is gone, the menu is not, the row says Bypass.
    expect(view.choices()).toHaveLength(0)
    expect(view.menu()).not.toBeNull()
    expect(view.value('Mode')).toBe('Bypass')
    await view.pick('Agent', 'Backend')
    expect(view.value('Agent')).toBe('Backend')
    await view.approve()
    expect(view.onApprove).toHaveBeenCalledWith('bypass', 'backend')
  })

  test('the agents: Any first, then the author and the others as monograms, then Everyone', async () => {
    const view = await render(['qa', 'lead', 'backend'])
    await view.open()
    await view.click(view.row('Agent'))
    const agents = view.choices()
    expect(agents.map(label)).toEqual(['Any agent', 'Lead', 'Qa', 'Backend', 'Everyone'])
    expect(description(agents[1]!)).toBe('Wrote the plan')
    expect(
      agents.map((element) => element.querySelectorAll('[data-slot="monogram-avatar"]').length),
    ).toEqual([0, 1, 1, 1, 0])
    await view.click(agents[4])
    await view.approve()
    expect(view.onApprove).toHaveBeenCalledWith('default', 'all')
  })

  test('picking an agent and then Any again sends no addressee', async () => {
    const view = await render(['lead', 'backend'])
    await view.open()
    await view.pick('Agent', 'Backend')
    await view.pick('Agent', 'Any agent')
    await view.approve()
    expect(view.onApprove).toHaveBeenCalledWith('default', undefined)
  })

  test('a one-agent chat has no Agent row and names nobody', async () => {
    const view = await render(['lead'])
    await view.open()
    expect(view.row('Agent')).toBeUndefined()
    expect(view.row('Mode')).toBeDefined()
    await view.approve()
    expect(view.onApprove).toHaveBeenCalledWith('default', undefined)
  })
})
