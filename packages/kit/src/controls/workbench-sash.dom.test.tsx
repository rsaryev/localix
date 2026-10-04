import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

test('WorkbenchSash keeps one exact hit target and forwards every resize gesture', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { WorkbenchSash } = await import('./button')
  const onMouseDown = mock(() => {})
  const onKeyDown = mock(() => {})
  const onDoubleClick = mock(() => {})
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  try {
    await act(async () =>
      root.render(
        <WorkbenchSash
          label="Resize panes"
          orientation="vertical"
          valueNow={50}
          valueText="50% for the first pane"
          resetLabel="equalize panes"
          onMouseDown={onMouseDown}
          onKeyDown={onKeyDown}
          onDoubleClick={onDoubleClick}
        />,
      ),
    )

    const sash = host.querySelector<HTMLElement>('[data-slot="workbench-sash"]')!
    expect(host.children).toHaveLength(1)
    expect(sash.parentElement).toBe(host)
    expect(sash.getAttribute('aria-description')).toContain('Use arrow keys to adjust')

    await act(async () => {
      sash.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      sash.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      sash.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    expect(onMouseDown).toHaveBeenCalledTimes(1)
    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(onDoubleClick).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
