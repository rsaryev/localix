import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const readSource = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

describe('session action chrome', () => {
  test('keeps individual-session actions on the shared sidebar icon control', () => {
    const source = readSource('SessionItemActions.tsx')

    expect(source).toContain("import { IconButton } from '@localixai/kit/icon-button'")
    // One predictable action slot at any sidebar width; pin and archive live in the menu.
    expect(source.match(/<IconButton/g)).toHaveLength(1)
    expect(source.match(/surface="sidebar"/g)).toHaveLength(1)
    expect(source).toContain('aria-label="Conversation actions"')
    expect(source).not.toContain('SESSION_ACTION_BUTTON_CLASS')
    expect(source).not.toContain('<button')
    expect(source).toContain('<DropdownMenuContent align="end" className="w-[190px]">')
    // The kebab renders the row's described entries, not its own transcribed list — the row's
    // right-click menu renders the same ones, and a hand-written second copy is how the two
    // would drift. (See `sessionMenuEntries`.)
    expect(source).toContain('<MenuEntries entries={entries} family="dropdown" />')
    expect(source).not.toContain('DropdownMenuItem')
    expect(source).not.toContain('bg-sidebar-accent/70')
    expect(source).not.toContain('shadow-sm')
    expect(source).not.toContain('shadow-lg')
    expect(source).not.toContain('rounded-[11px]')
  })

  test('keeps both session menu entry points inside the sidebar', () => {
    const row = readSource('SessionItem.tsx')
    const actions = readSource('SessionItemActions.tsx')
    const sidebar = readSource('ChatSidebar.tsx')

    // A native browser pane can begin immediately beside the sidebar. Both menu entry points
    // share one action list; the right-click path must use Radix's pane collision boundary.
    expect(sidebar).toContain('data-context-menu-boundary')
    expect(row).toContain("closest<HTMLElement>('[data-context-menu-boundary]')")
    expect(row).toContain('collisionBoundary={menuBoundary ?? undefined}')
    expect(actions).toContain('<DropdownMenuContent align="end" className="w-[190px]">')
    expect(row).toContain('<MenuEntries entries={menuEntries} family="context" />')
    expect(actions).toContain('<MenuEntries entries={entries} family="dropdown" />')
  })

  test('lets the shared dropdown recipe own view-menu chrome', () => {
    const source = readSource('ChatSidebarViewMenu.tsx')

    expect(source).toContain('<IconButton')
    expect(source).toContain('surface="sidebar"')
    expect(source).toContain('aria-label="Conversation view options"')
    expect(source).not.toContain('<button')
    expect(source).toContain('<DropdownMenuContent align="end" className="w-[190px]">')
    expect(source).toContain('family="dropdown"')
    expect(source).not.toContain('DropdownMenuItem')
    expect(source).not.toContain('shadow-lg')
    expect(source).not.toContain('rounded-[11px]')
    expect(source).not.toContain('p-[0.3rem]')
  })

  test('keeps batch actions on a divider instead of another dock surface', () => {
    const source = readSource('SessionBatchBar.tsx')

    expect(source).toContain('border-t border-sidebar-border/40 px-2.5 py-2')
    expect(source).toContain("import { IconButton } from '@localixai/kit/icon-button'")
    expect(source).toContain('surface="sidebar"')
    expect(source).not.toContain('<button')
    expect(source).not.toContain('bg-sidebar/95')
    expect(source).not.toContain('backdrop-blur')
    expect(source).not.toContain('shadow-sm')
  })

  test('uses the same action primitive in both chat headers', () => {
    const sidebar = readSource('ChatSidebarHeader.tsx')
    const conversationHeader = readFileSync(
      new URL('../../../widgets/chat-workspace/ui/ChatHeaderActions.tsx', import.meta.url),
      'utf8',
    )

    expect(sidebar).not.toContain('function HeaderIconButton')
    // Search and add-project use the shared icon primitive. What
    // this test defends is that every one of them is the shared primitive rather than a
    // hand-rolled button, which is what the header used to be full of.
    expect(sidebar.match(/<IconButton/g)).toHaveLength(2)
    expect(sidebar.match(/surface="sidebar"/g)).toHaveLength(2)
    expect(sidebar).not.toContain('New chat')
    expect(conversationHeader).toContain('<IconButton')
    expect(conversationHeader).toContain('aria-label="Find in conversation"')
    expect(conversationHeader).not.toContain('<button')
  })
})
