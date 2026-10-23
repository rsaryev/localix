import { afterAll, beforeAll, expect, test } from 'bun:test'
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

test('a long catalog scrolls independently of its management footer and keeps keyboard order', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RailToolMenu } = await import('./RailToolMenu')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let managed = 0
  let opened = 0
  try {
    await act(async () =>
      root.render(
        <RailToolMenu
          label="All tools"
          icon={<span />}
          active={false}
          entries={Array.from({ length: 40 }, (_, index) => ({
            id: `tool-${index}`,
            label: `Tool ${index}`,
            active: false,
            icon: <span />,
            toolCategory: 'utilities',
            onClick: () => {
              opened += 1
            },
          }))}
          onManage={() => {
            managed += 1
          }}
        />,
      ),
    )
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="All tools"]')!
    await act(async () => {
      trigger.focus()
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    const list = menu.querySelector<HTMLElement>('[data-rail-tool-menu-list]')!
    const footer = menu.querySelector<HTMLElement>('[data-rail-tool-menu-footer]')!
    expect(list.contains(footer)).toBe(false)
    const rows = [...list.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    expect(rows).toHaveLength(40)
    const manage = footer.querySelector<HTMLElement>('[role="menuitem"]')!
    await act(async () => {
      rows.at(-1)!.focus()
      rows.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.activeElement).toBe(manage)
    await act(async () =>
      manage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    )
    expect(managed).toBe(1)
    expect(opened).toBe(0)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
