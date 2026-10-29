import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { GitBranch, Pin } from 'lucide-react'

import { registerDom } from '../testing/dom'
import { DropdownMenu, DropdownMenuContent } from './dropdown-menu'
import { MenuEntries } from './menu-entries'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/**
 * The walker, in a menu that is already open.
 *
 * `open` on the root rather than a click on a trigger: what is under test is what the entries
 * BECOME, and driving Radix's own open/close would be testing Radix.
 */
async function openMenu(entries: readonly MenuEntry[], onOpenChange?: (open: boolean) => void) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <DropdownMenu open onOpenChange={onOpenChange}>
        <DropdownMenuContent>
          <MenuEntries entries={entries} family="dropdown" />
        </DropdownMenuContent>
      </DropdownMenu>,
    ),
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return {
    act,
    menu: document.body.querySelector('[role="menu"]'),
    rows: () => [...document.body.querySelectorAll('[role="menu"] > *')],
    async close() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const rowKind = (element: Element): string =>
  element.getAttribute('role') ?? element.tagName.toLowerCase()

describe('the described-menu walker', () => {
  for (const checked of [undefined, false]) {
    test(`a trailing action is independently keyboard accessible (checked=${checked})`, async () => {
      const picks: string[] = []
      const changes: boolean[] = []
      const view = await openMenu(
        [
          {
            id: 'viewer',
            label: 'Viewer',
            checked,
            onSelect: () => picks.push('open'),
            trailingAction: {
              label: 'Unpin Viewer',
              icon: Pin,
              checked: true,
              onSelect: () => picks.push('unpin'),
            },
          },
        ],
        (open) => changes.push(open),
      )
      try {
        const primary = view.menu!.querySelector<HTMLElement>('[data-radix-collection-item]')!
        const pin = view.menu!.querySelector<HTMLElement>('[aria-label="Unpin Viewer"]')!
        expect(pin.getAttribute('role')).toBe('menuitemcheckbox')
        expect(pin.getAttribute('aria-checked')).toBe('true')
        await view.act(async () => {
          primary.focus()
          primary.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
        expect(document.activeElement).toBe(pin)
        await view.act(async () =>
          pin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
        )
        expect(picks).toEqual(['unpin'])
        expect(changes).toEqual([])
        await view.act(async () => primary.click())
        expect(picks).toEqual(['unpin', 'open'])
        expect(changes).toEqual([false])
      } finally {
        await view.close()
      }
    })
  }
  test('a submenu renders into a PORTAL, not inside the panel that would clip it', async () => {
    // The defect this pins: `SubContent` rendered inline lands inside the parent panel, which is
    // `overflow-y-auto overscroll-contain` — so the submenu was clipped to the parent's box and
    // never appeared. Both menu families shipped that way at once.
    const view = await openMenu([
      {
        id: 'branches',
        label: 'Switch branch',
        items: [{ id: 'main', label: 'main', onSelect: () => {} }],
      },
    ])
    try {
      const trigger = document.body.querySelector(
        '[data-radix-menu-content] [aria-haspopup="menu"]',
      )
      expect(trigger).not.toBeNull()
      // Radix renders `SubContent` into its own portal container, a SIBLING of the root panel's.
      const panels = [...document.body.querySelectorAll('[data-radix-menu-content]')]
      expect(panels.length).toBeGreaterThanOrEqual(1)
      expect(panels.some((panel) => panel.contains(trigger!) && panel !== panels[0])).toBe(false)
    } finally {
      await view.close()
    }
  })

  test('an empty submenu says what is missing instead of opening onto nothing', async () => {
    const view = await openMenu([
      { id: 'branches', label: 'Switch branch', items: [], emptyLabel: 'No other branches' },
    ])
    try {
      // The trigger still renders; the placeholder is what its panel would carry.
      expect(view.menu?.textContent).toContain('Switch branch')
    } finally {
      await view.close()
    }
  })

  test('the seams an empty spread leaves are gone by the time anything renders', async () => {
    // `[open, —, ...rows, —, ...actions]` with no rows and no actions: the shape every bundled
    // mini app builds, on a session with nothing to list.
    const view = await openMenu([
      { id: 'open', label: 'Open', onSelect: () => {} },
      { separator: true },
      { separator: true },
      { id: 'settings', label: 'Mini app settings…', onSelect: () => {} },
      { separator: true },
    ])
    try {
      const kinds = view.rows().map(rowKind)
      expect(kinds.filter((kind) => kind === 'separator')).toHaveLength(1)
      expect(kinds.at(-1)).toBe('menuitem')
    } finally {
      await view.close()
    }
  })

  test('a header renders as a group title, not as an unavailable command', async () => {
    const view = await openMenu([
      { header: 'Running' },
      { id: 'w', label: 'worker-1', onSelect: () => {} },
    ])
    try {
      expect(view.menu?.textContent).toContain('Running')
      // A disabled item is what mini apps reached for instead, and it is focusable and announced as
      // a command. A label is neither.
      expect(view.menu?.querySelectorAll('[role="menuitem"]')).toHaveLength(1)
    } finally {
      await view.close()
    }
  })

  test('a level with an icon indents every row in it, including the ones without', async () => {
    const view = await openMenu([
      { id: 'fetch', label: 'Fetch', onSelect: () => {} },
      { id: 'main', label: 'main', icon: GitBranch, checked: true, onSelect: () => {} },
    ])
    try {
      const rows = view.rows().filter((row) => rowKind(row).startsWith('menuitem'))
      expect(rows).toHaveLength(2)
      for (const row of rows)
        expect(row.firstElementChild?.getAttribute('data-slot')).toBe('menu-leading-icon')
    } finally {
      await view.close()
    }
  })

  test('a level of plain actions keeps its labels on the text edge', async () => {
    const view = await openMenu([
      { id: 'fetch', label: 'Fetch', onSelect: () => {} },
      { id: 'pull', label: 'Pull', onSelect: () => {} },
    ])
    try {
      for (const row of view.rows())
        expect(row.querySelector('[data-slot="menu-leading-icon"]')).toBeNull()
    } finally {
      await view.close()
    }
  })

  test('a checked row keeps its icon in front and its check at the end, like a selected row', async () => {
    // The defect: the check took the icon's leading slot, so a multi-select filter (status dots,
    // priority marks, log severities) showed bare names while a `selected` row kept its icon.
    const view = await openMenu([
      { id: 'save', label: 'Save', icon: GitBranch, onSelect: () => {} },
      { id: 'outline', label: 'Outline', icon: GitBranch, checked: false, onSelect: () => {} },
      { id: 'split', label: 'Split', icon: GitBranch, checked: true, onSelect: () => {} },
    ])
    try {
      const rows = view.rows().filter((row) => rowKind(row).startsWith('menuitem'))
      expect(rows.map(rowKind)).toEqual(['menuitem', 'menuitemcheckbox', 'menuitemcheckbox'])
      for (const row of rows) {
        expect(row.firstElementChild?.getAttribute('data-slot')).toBe('menu-leading-icon')
        // A direct SVG is an extra flex child before the label, which shifts that row's label.
        expect([...row.children].some((child) => child.tagName.toLowerCase() === 'svg')).toBe(false)
        // The icon sits in the leading slot, before the label.
        expect(row.firstElementChild?.querySelector('svg')).not.toBeNull()
      }
      expect(rows[1]?.getAttribute('aria-checked')).toBe('false')
      expect(rows[2]?.getAttribute('aria-checked')).toBe('true')
      // The checked row ends on the check; the unchecked one keeps the slot, empty, so hints align.
      expect(rows[1]?.lastElementChild?.querySelector('svg')).toBeNull()
      expect(rows[2]?.lastElementChild?.querySelector('svg')).not.toBeNull()
    } finally {
      await view.close()
    }
  })

  test('bare checked rows stay on the text edge — a check claims no leading column', async () => {
    const view = await openMenu([
      { id: 'a', label: 'Errors', checked: true, onSelect: () => {} },
      { id: 'b', label: 'Warnings', checked: false, onSelect: () => {} },
    ])
    try {
      for (const row of view.rows())
        expect(row.querySelector('[data-slot="menu-leading-icon"]')).toBeNull()
    } finally {
      await view.close()
    }
  })

  test('an icon takes the leading column and indents its level, so labels line up', async () => {
    const view = await openMenu([
      { id: 'open', label: 'Open Git', icon: GitBranch, onSelect: () => {} },
      { id: 'fetch', label: 'Fetch', onSelect: () => {} },
    ])
    try {
      const rows = view.rows()
      for (const row of rows)
        expect(row.firstElementChild?.getAttribute('data-slot')).toBe('menu-leading-icon')
      expect(rows[0]?.querySelector('svg')).not.toBeNull()
    } finally {
      await view.close()
    }
  })

  test('a recommended row carries the travelling accent; a plain or disabled one does not', async () => {
    const view = await openMenu([
      { id: 'mode', label: 'Mode', onSelect: () => {} },
      { id: 'approve', label: 'Approve', recommended: true, onSelect: () => {} },
      { id: 'off', label: 'Off', recommended: true, disabled: true, onSelect: () => {} },
    ])
    try {
      const [plain, marked, disabled] = view.rows()
      const beam = marked!.querySelector('.lx-border-beam')
      expect(beam?.getAttribute('aria-hidden')).toBe('true')
      expect(beam?.getAttribute('data-intensity')).toBe('2')
      expect(marked!.hasAttribute('data-recommended')).toBe(true)
      expect(marked!.getAttribute('role')).toBe('menuitem')
      expect(plain!.querySelector('.lx-border-beam')).toBeNull()
      expect(disabled!.querySelector('.lx-border-beam')).toBeNull()
    } finally {
      await view.close()
    }
  })

  test('a trailing hint renders beside the label rather than inside it', async () => {
    const view = await openMenu([
      {
        id: 'branches',
        label: 'Switch branch',
        hint: 'main',
        items: [{ id: 'a', label: 'a', onSelect: () => {} }],
      },
    ])
    try {
      expect(view.menu?.textContent).toContain('Switch branch')
      expect(view.menu?.textContent).toContain('main')
    } finally {
      await view.close()
    }
  })

  test('a description sits under its label as its own line, never truncated beside it', async () => {
    const sentence = 'Read-only: the agent investigates and presents a plan for you to approve.'
    const view = await openMenu([
      { id: 'plan', label: 'Plan', description: sentence, checked: false, onSelect: () => {} },
    ])
    try {
      const line = [...(view.menu?.querySelectorAll('span') ?? [])].find(
        (span) => span.textContent === sentence,
      )
      expect(line).toBeDefined()
      expect(line?.previousElementSibling?.textContent).toBe('Plan')
    } finally {
      await view.close()
    }
  })

  test('a selected choice keeps its icon in front and its check at the end', async () => {
    // The defect: a choice list drawn as `checked` rows lost every icon to the leading check, so
    // the mode menu showed bare names where the composer showed each mode's icon.
    const view = await openMenu([
      { id: 'a', label: 'Default', icon: GitBranch, selected: true, onSelect: () => {} },
      { id: 'b', label: 'Bypass', icon: GitBranch, selected: false, onSelect: () => {} },
    ])
    try {
      const rows = view.rows()
      expect(rows.map(rowKind)).toEqual(['menuitemradio', 'menuitemradio'])
      expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['true', 'false'])
      for (const row of rows) {
        // The icon sits in the leading slot, before the label.
        expect(row.firstElementChild?.querySelector('svg')).not.toBeNull()
        expect(row.firstElementChild?.getAttribute('data-slot')).toBe('menu-leading-icon')
      }
      // The chosen row ends on the check; the other keeps the slot empty so hints align.
      expect(rows[0]?.lastElementChild?.querySelector('svg')).not.toBeNull()
      expect(rows[1]?.lastElementChild?.querySelector('svg')).toBeNull()
    } finally {
      await view.close()
    }
  })

  test('keepOpen picks without closing; a plain row closes the menu', async () => {
    const changes: boolean[] = []
    const picked: string[] = []
    const view = await openMenu(
      [
        { id: 'k', label: 'Stay', keepOpen: true, onSelect: () => picked.push('k') },
        { id: 'p', label: 'Go', onSelect: () => picked.push('p') },
      ],
      (open) => changes.push(open),
    )
    try {
      const [stay, go] = view.rows() as HTMLElement[]
      await view.act(async () => stay!.click())
      expect(picked).toEqual(['k'])
      expect(changes).toEqual([])
      await view.act(async () => go!.click())
      expect(picked).toEqual(['k', 'p'])
      expect(changes).toEqual([false])
    } finally {
      await view.close()
    }
  })

  test('a keepOpen choice in a submenu steps back to its trigger, whose hint shows it', async () => {
    let mode = 'Default'
    const changes: boolean[] = []
    const entries = (): MenuEntry[] => [
      {
        id: 'mode',
        label: 'Mode',
        hint: mode,
        items: ['Default', 'Bypass'].map((name) => ({
          id: name,
          label: name,
          selected: name === mode,
          keepOpen: true,
          onSelect: () => {
            mode = name
          },
        })),
      },
    ]
    const view = await openMenu(entries(), (open) => changes.push(open))
    try {
      const trigger = document.body.querySelector<HTMLElement>('[aria-haspopup="menu"]')!
      expect(trigger.textContent).toContain('Default')
      await view.act(async () => {
        trigger.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const bypass = [
        ...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
      ].find((row) => row.textContent === 'Bypass')
      expect(bypass).toBeDefined()
      await view.act(async () => {
        bypass!.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(mode).toBe('Bypass')
      // The root menu stays; the submenu is gone and focus is back on its trigger.
      expect(changes).toEqual([])
      expect(document.body.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0)
      expect(document.activeElement).toBe(trigger)
    } finally {
      await view.close()
    }
  })
})
