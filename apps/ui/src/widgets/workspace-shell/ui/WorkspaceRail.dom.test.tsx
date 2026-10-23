import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UseRailDnd } from '../model/useRailDnd'
import type { RailEntry } from './shellTypes'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const noOp = () => {}
const entry = (id: string): RailEntry => ({
  id,
  label: id,
  icon: <span />,
  active: false,
  onClick: noOp,
})

test('top and bottom rails place their entries, route drags and bound the move menu', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WorkspaceRail } = await import('./WorkspaceRail')
  const dnd: UseRailDnd = {
    drag: { dragId: null, target: null, overZone: null },
    clearDrag: mock(),
    onDragStart: mock(),
    onDragOverItem: mock(),
    onDropItem: mock(),
    onZoneDragOver: mock(),
    onZoneDragLeave: mock(),
    onZoneDrop: mock(),
  }
  const onMoveToArea = mock()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <WorkspaceRail
        onCreateChat={noOp}
        historyActive={false}
        onHistoryClick={noOp}
        topEntries={[entry('top-1'), entry('top-2')]}
        barEntries={[]}
        toolEntries={[]}
        pinnedToolIds={new Set()}
        onPinTool={noOp}
        onUnpinTool={noOp}
        bottomEntries={[entry('bottom-1'), entry('bottom-2')]}
        onMoveToArea={onMoveToArea}
        onMoveWithinBar={noOp}
        onResetRail={noOp}
        miniAppsPending={false}
        onCapabilitiesClick={noOp}
        dnd={dnd}
        topRailActions={[]}
        mainRailActions={[]}
        bottomRailActions={[]}
        systemRailActions={[]}
      />,
    ),
  )
  const button = (label: string) =>
    host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  const groupOf = (label: string) =>
    button(label).closest('[data-rail-group]')?.getAttribute('data-rail-group')
  expect(groupOf('top-1')).toBe('navigation')
  expect(groupOf('top-2')).toBe('navigation')
  expect(groupOf('bottom-1')).toBe('system')
  expect(groupOf('bottom-2')).toBe('system')

  await act(async () => {
    button('top-2').dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
    button('bottom-1').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    button('bottom-2').dispatchEvent(new Event('dragend', { bubbles: true }))
  })
  expect((dnd.onDragOverItem as ReturnType<typeof mock>).mock.calls[0]?.slice(1)).toEqual([
    'top-2',
    'top',
  ])
  expect((dnd.onDropItem as ReturnType<typeof mock>).mock.calls[0]?.slice(1)).toEqual([
    'bottom-1',
    'bottom',
  ])
  expect(dnd.clearDrag).toHaveBeenCalled()

  const openMenu = async (label: string) => {
    await act(async () => {
      button(label).dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: 2,
          clientX: 40,
          clientY: 40,
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const item = (text: string) => items.find((node) => node.textContent?.includes(text))!
    return { item }
  }
  const disabled = (node: HTMLElement) => node.hasAttribute('data-disabled')
  const closeMenu = () =>
    act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )

  const first = await openMenu('top-1')
  expect(disabled(first.item('Move up'))).toBe(true)
  expect(disabled(first.item('Move down'))).toBe(false)
  expect(first.item('Move to top')).toBeUndefined()
  await closeMenu()

  const last = await openMenu('bottom-2')
  expect(disabled(last.item('Move up'))).toBe(false)
  expect(disabled(last.item('Move down'))).toBe(true)
  expect(last.item('Move to lower rail')).toBeUndefined()
  await act(async () => {
    last.item('Move to workspace').click()
  })
  expect(onMoveToArea).toHaveBeenCalledWith('bottom-2', 'bar')
  await closeMenu()

  await act(async () => root.unmount())
  host.remove()
})
