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

test('hover previews a menu, crossing into it keeps it open and clicking makes it stay', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RailToolMenu } = await import('./RailToolMenu')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const editor = document.createElement('input')
  document.body.append(editor)
  let opens = 0
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const move = (element: Element, type: 'mouseover' | 'mouseout', relatedTarget?: Element) =>
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget }))
  const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
  try {
    await act(async () =>
      root.render(
        <RailToolMenu
          label="Tools"
          icon={<span />}
          active={false}
          entries={[
            {
              id: 'vault',
              label: 'Vault',
              icon: <span />,
              active: false,
              toolCategory: 'utilities',
              onClick: () => {
                opens += 1
              },
            },
          ]}
        />,
      ),
    )
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Tools"]')!
    editor.focus()
    await act(async () => {
      move(trigger, 'mouseover')
      await wait(60)
    })
    expect(menu()).toBeNull()
    await act(async () => {
      await wait(90)
    })
    expect(menu()).not.toBeNull()
    expect(document.activeElement).toBe(editor)
    await act(async () => {
      move(trigger, 'mouseout', menu()!)
      move(menu()!, 'mouseover', trigger)
      await wait(240)
    })
    expect(menu()).not.toBeNull()
    await act(async () => {
      move(menu()!, 'mouseout')
      await wait(240)
    })
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(editor)
    await act(async () => {
      move(trigger, 'mouseover')
      move(trigger, 'mouseout')
      await wait(240)
    })
    expect(menu()).toBeNull()
    await act(async () => {
      move(trigger, 'mouseover')
      await wait(150)
    })
    expect(menu()).not.toBeNull()
    await act(async () =>
      trigger.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
          cancelable: true,
        }),
      ),
    )
    expect(menu()).not.toBeNull()
    await act(async () => {
      move(trigger, 'mouseout')
      await wait(240)
    })
    expect(menu()).not.toBeNull()
    const vault = menu()!.querySelector<HTMLElement>('[role="menuitemradio"]')!
    await act(async () => vault.click())
    expect(opens).toBe(1)
    expect(menu()).toBeNull()
    await act(async () =>
      trigger.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'touch',
          cancelable: true,
        }),
      ),
    )
    expect(menu()).not.toBeNull()
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    expect(menu()).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    editor.remove()
  }
})
