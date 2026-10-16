import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { RAIL_LAYOUT_STORAGE_KEY } from '../model/railLayout'
import { RAIL_RECENTS_STORAGE_KEY } from '../model/railRecents'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('clicked rail menus switch on hover without overlapping or losing their persistent mode', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WorkspaceShell } = await import('./WorkspaceShell')
  localStorage.removeItem(RAIL_LAYOUT_STORAGE_KEY)
  localStorage.removeItem(RAIL_RECENTS_STORAGE_KEY)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const noOp = () => {}
  const button = (label: string) =>
    host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  const menus = () => [...document.querySelectorAll<HTMLElement>('[role="menu"]')]
  const pause = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
  const hover = (target: HTMLElement, entering: boolean) =>
    act(async () => {
      target.dispatchEvent(new MouseEvent(entering ? 'mouseover' : 'mouseout', { bubbles: true }))
    })
  const press = (target: HTMLElement) =>
    act(async () =>
      target.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerType: 'mouse',
        }),
      ),
    )
  try {
    await act(async () =>
      root.render(
        <WorkspaceShell
          isMobile={false}
          statusSessionId={null}
          sidebarOpen={false}
          onOpenSidebar={noOp}
          onCloseSidebar={noOp}
          onCreateChat={noOp}
          railActions={(['development', 'utilities'] as const).flatMap((category) =>
            [1, 2, 3].map((index) => ({
              id: `${category}-${index}`,
              label: `${category} tool ${index}`,
              icon: <span />,
              customizable: true,
              toolCategory: category,
              onClick: noOp,
            })),
          )}
        >
          <div />
        </WorkspaceShell>,
      ),
    )
    await press(button('Workspace'))
    expect(menus()).toHaveLength(1)
    expect(menus()[0]?.textContent).toContain('development tool 1')
    await hover(button('Tools'), true)
    await pause()
    expect(menus()).toHaveLength(1)
    expect(menus()[0]?.textContent).toContain('utilities tool 1')
    expect(menus()[0]?.textContent).not.toContain('development tool 1')
    expect(button('Workspace').getAttribute('aria-expanded')).toBe('false')
    expect(button('Tools').getAttribute('aria-expanded')).toBe('true')
    // Clicking starts persistent navigation, so switching categories does not restore hover-close.
    await hover(button('Tools'), false)
    await pause()
    expect(menus()).toHaveLength(1)
    await press(button('Tools'))
    expect(menus()).toHaveLength(1)
    await press(button('Tools'))
    expect(menus()).toHaveLength(0)
    await pause()
    await hover(button('Workspace'), true)
    await pause()
    expect(menus()).toHaveLength(1)
    await press(button('Workspace'))
    await hover(button('Workspace'), false)
    await pause()
    expect(menus()).toHaveLength(1)
    // The catalog belongs to the same group, including its pin actions.
    await hover(button('All tools'), true)
    await pause()
    expect(menus()).toHaveLength(1)
    expect(menus()[0]?.querySelector('[role="menuitemcheckbox"]')).not.toBeNull()
    await hover(button('All tools'), false)
    await pause()
    expect(menus()).toHaveLength(1)
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    expect(menus()).toHaveLength(0)
    await pause()
    // Keyboard activation still returns focus to its trigger when dismissed.
    await act(async () => {
      button('Workspace').focus()
      button('Workspace').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })
    expect(menus()).toHaveLength(1)
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    await pause()
    expect(menus()).toHaveLength(0)
    expect(document.activeElement).toBe(button('Workspace'))
  } finally {
    await act(async () => root.unmount())
    host.remove()
    localStorage.removeItem(RAIL_LAYOUT_STORAGE_KEY)
    localStorage.removeItem(RAIL_RECENTS_STORAGE_KEY)
  }
})
