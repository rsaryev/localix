import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type * as React from 'react'
import {
  ContextMenu as ContextMenuPrimitive,
  DropdownMenu as DropdownMenuPrimitive,
} from 'radix-ui'

import { registerDom } from '../testing/dom'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './context-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './dropdown-menu'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

type Rows = {
  Item: React.ElementType
  CheckboxItem: React.ElementType
  Label: React.ElementType
  Separator: React.ElementType
  Sub: React.ElementType
  SubTrigger: React.ElementType
  SubContent: React.ElementType
}

/** One family's rows, mounted in a menu that is open. */
type Family = {
  name: string
  primitive: Record<string, unknown>
  heightVar: string
  rows: Rows
  open: (rows: React.ReactNode) => React.ReactNode
  afterRender?: (host: HTMLElement) => void
}

const families: Family[] = [
  {
    name: 'dropdown',
    primitive: DropdownMenuPrimitive,
    heightVar: '--radix-dropdown-menu-content-available-height',
    rows: {
      Item: DropdownMenuItem,
      CheckboxItem: DropdownMenuCheckboxItem,
      Label: DropdownMenuLabel,
      Separator: DropdownMenuSeparator,
      Sub: DropdownMenuSub,
      SubTrigger: DropdownMenuSubTrigger,
      SubContent: DropdownMenuSubContent,
    },
    open: (rows) => (
      <DropdownMenu open>
        <DropdownMenuContent>{rows}</DropdownMenuContent>
      </DropdownMenu>
    ),
  },
  {
    name: 'context',
    primitive: ContextMenuPrimitive,
    heightVar: '--radix-context-menu-content-available-height',
    rows: {
      Item: ContextMenuItem,
      CheckboxItem: ContextMenuCheckboxItem,
      Label: ContextMenuLabel,
      Separator: ContextMenuSeparator,
      Sub: ContextMenuSub,
      SubTrigger: ContextMenuSubTrigger,
      SubContent: ContextMenuSubContent,
    },
    open: (rows) => (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button type="button">Target</button>
        </ContextMenuTrigger>
        <ContextMenuContent>{rows}</ContextMenuContent>
      </ContextMenu>
    ),
    afterRender: (host) =>
      host
        .querySelector('button')!
        .dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
        ),
  },
]

for (const family of families) {
  describe(`${family.name} menu rows`, () => {
    test('render their roles, tones, insets, checks and submenu', async () => {
      const { act } = await import('react')
      const { createRoot } = await import('react-dom/client')
      const host = document.createElement('div')
      document.body.append(host)
      const root = createRoot(host)
      const R = family.rows
      try {
        await act(async () =>
          root.render(
            family.open(
              <>
                <R.Label inset>Section</R.Label>
                <R.Item tone="danger">Delete</R.Item>
                <R.Item inset className="extra">
                  Plain
                </R.Item>
                <R.Separator data-testid="sep" />
                <R.CheckboxItem checked>On</R.CheckboxItem>
                <R.CheckboxItem checked={false} inset>
                  Off
                </R.CheckboxItem>
                <R.Sub open>
                  <R.SubTrigger inset>More</R.SubTrigger>
                  <R.SubContent>
                    <R.Item>Nested</R.Item>
                  </R.SubContent>
                </R.Sub>
              </>,
            ),
          ),
        )
        await act(async () => {
          family.afterRender?.(host)
          await new Promise((resolve) => setTimeout(resolve, 0))
        })

        const menus = [...document.body.querySelectorAll<HTMLElement>('[role="menu"]')]
        expect(menus).toHaveLength(2)
        const [menu, sub] = menus as [HTMLElement, HTMLElement]
        // The submenu is portalled beside the root panel, never inside its scroll box.
        expect(menu.contains(sub)).toBe(false)
        expect(sub.textContent).toBe('Nested')
        expect(sub.className).toContain(`max-h-[var(${family.heightVar})]`)

        const label = [...menu.querySelectorAll('div')].find((el) => el.textContent === 'Section')
        expect(label?.className).toContain('uppercase')
        expect(label?.className).toContain('pl-8')

        const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        const danger = items.find((el) => el.textContent === 'Delete')!
        expect(danger.className).toContain('text-status-error')
        expect(danger.className).not.toContain('pl-8')
        const plain = items.find((el) => el.textContent === 'Plain')!
        expect(plain.className).not.toContain('text-status-error')
        expect(plain.className).toContain('pl-8')
        expect(plain.className).toContain('extra')

        const separator = menu.querySelector<HTMLElement>('[data-testid="sep"]')!
        expect(separator.getAttribute('role')).toBe('separator')
        expect(separator.className).toContain('bg-border')

        const checks = [...menu.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')]
        expect(checks.map((el) => el.getAttribute('aria-checked'))).toEqual(['true', 'false'])
        expect(checks[0]!.querySelector('svg')).not.toBeNull()
        expect(checks[1]!.querySelector('svg')).toBeNull()
        expect(checks[0]!.className).not.toContain('pl-8')
        expect(checks[1]!.className).toContain('pl-8')

        const trigger = items.find((el) => el.textContent === 'More')!
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
        expect(trigger.className).toContain('pl-8')
        expect(trigger.className).toContain('data-[state=open]:bg-popover-hover')
        expect(trigger.querySelector('svg')).not.toBeNull()
      } finally {
        await act(async () => root.unmount())
        host.remove()
      }
    })

    test("carry their primitive's display name", () => {
      const R = family.rows as unknown as Record<string, { displayName?: string }>
      const P = family.primitive as Record<string, { displayName?: string }>
      for (const part of ['Item', 'CheckboxItem', 'Label', 'Separator', 'SubTrigger', 'SubContent'])
        expect(R[part]!.displayName).toBe(P[part]!.displayName)
    })
  })
}
