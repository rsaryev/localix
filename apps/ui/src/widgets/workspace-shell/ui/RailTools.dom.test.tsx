import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { RAIL_LAYOUT_STORAGE_KEY } from '../model/railLayout'
import { RAIL_RECENTS_STORAGE_KEY } from '../model/railRecents'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('core and plugin tools share pins, grouping and a catalog; management opens Settings', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WorkspaceShell } = await import('./WorkspaceShell')
  localStorage.removeItem(RAIL_LAYOUT_STORAGE_KEY)
  localStorage.removeItem(RAIL_RECENTS_STORAGE_KEY)
  const host = document.createElement('div')
  document.body.append(host)
  let root = createRoot(host)
  const opened: string[] = []
  const destinations: string[] = []
  let sidebarOpens = 0
  const noOp = () => {}
  const shell = (
    <WorkspaceShell
      isMobile={false}
      statusSessionId={null}
      sidebarOpen={false}
      miniAppsManageUri="localix://ui/settings/mini-apps"
      onNavigateUi={(uri) => destinations.push(uri)}
      onOpenSidebar={() => {
        sidebarOpens += 1
      }}
      onCloseSidebar={noOp}
      onCreateChat={noOp}
      miniAppCategories={
        new Map([
          ['game-one', 'games'],
          ['game-two', 'games'],
          ['game-three', 'games'],
        ])
      }
      railActions={[
        {
          id: 'usage',
          label: 'Usage & Spend',
          icon: <span />,
          customizable: true,
          toolCategory: 'utilities',
          onClick: () => opened.push('usage'),
        },
        {
          id: 'vault',
          label: 'Vault — secrets & credentials',
          icon: <span />,
          customizable: true,
          toolCategory: 'utilities',
          onClick: () => opened.push('vault'),
        },
        ...['game-one', 'game-two', 'game-three'].map((id) => ({
          id,
          label: id,
          icon: <span />,
          customizable: true,
          plugin: true,
          pluginName: id,
          onClick: () => opened.push(id),
        })),
      ]}
    >
      <div />
    </WorkspaceShell>
  )
  const paint = () => React.act(async () => root.render(shell))
  const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
  const openCatalog = async () => {
    await React.act(async () => {
      button('All tools')!.focus()
      button('All tools')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
  const toggle = async (label: string) => {
    const pin = document.querySelector<HTMLElement>(
      `[role="menuitemcheckbox"][aria-label="${label}"]`,
    )
    expect(pin).not.toBeNull()
    await React.act(async () => pin!.click())
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
  }
  const dismiss = () =>
    React.act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
  try {
    await paint()
    expect(button('Usage & Spend')?.getAttribute('draggable')).toBe('true')
    expect(button('Vault — secrets & credentials')).not.toBeNull()
    expect(button('Games')).not.toBeNull()
    expect(button('Tools')).toBeNull()
    expect(button('game-one')).toBeNull()
    expect(button('Plugins')).toBeNull()
    await openCatalog()
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Tools')
    await toggle('Unpin Usage & Spend')
    expect(button('Usage & Spend')).toBeNull()
    expect(opened).toEqual([])
    expect(
      document.querySelector('[aria-label="Pin Usage & Spend"]')?.getAttribute('aria-checked'),
    ).toBe('false')
    await toggle('Pin Usage & Spend')
    expect(button('Usage & Spend')).not.toBeNull()
    await toggle('Unpin game-one')
    expect(button('Games')).toBeNull()
    expect(button('game-two')).not.toBeNull()
    expect(button('game-three')).not.toBeNull()
    await toggle('Unpin Vault')
    await dismiss()
    await React.act(async () => root.unmount())
    root = createRoot(host)
    await paint()
    expect(button('Vault — secrets & credentials')).toBeNull()
    expect(button('Games')).toBeNull()
    expect(button('Usage & Spend')).not.toBeNull()
    await openCatalog()
    const vault = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (item) => item.textContent === 'Vault',
    )!
    await React.act(async () => vault.click())
    expect(opened).toEqual(['vault'])
    expect(host.querySelector('[data-rail-recents-trigger]')).not.toBeNull()
    await openCatalog()
    await toggle('Pin Vault')
    expect(host.querySelector('[data-rail-recents-trigger]')).toBeNull()
    const manage = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === 'Manage mini apps…',
    )!
    await React.act(async () => manage.click())
    expect(destinations).toEqual(['localix://ui/settings/mini-apps'])
    expect(sidebarOpens).toBe(0)
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
    localStorage.removeItem(RAIL_LAYOUT_STORAGE_KEY)
    localStorage.removeItem(RAIL_RECENTS_STORAGE_KEY)
  }
})
