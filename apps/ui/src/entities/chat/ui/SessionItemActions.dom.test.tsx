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

test('the quiet action slot remains keyboard reachable and keeps its open menu visible', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SessionItemActions } = await import('./SessionItemActions')
  let picked = false
  function Row() {
    const [open, setOpen] = React.useState(false)
    return (
      <div className="group/workbench-row">
        <SessionItemActions
          menuOpen={open}
          onMenuOpenChange={setOpen}
          entries={[{ id: 'rename', label: 'Rename', onSelect: () => (picked = true) }]}
          fallback={<span title="Updated today">2h</span>}
        />
      </div>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await React.act(async () => root.render(<Row />))
    const slot = host.querySelector<HTMLElement>('[data-slot="workbench-list-row-actions"]')!
    const button = host.querySelector<HTMLButtonElement>('button')!
    const controls = slot.querySelector<HTMLElement>(
      '[data-slot="workbench-list-row-action-controls"]',
    )!
    const fallback = slot.querySelector<HTMLElement>(
      '[data-slot="workbench-list-row-action-fallback"]',
    )!
    expect(slot.dataset.visibility).toBe('hover')
    // The kit owns reveal on row hover/focus, plus the shared touch-device override.
    expect(slot.classList.contains('grid')).toBe(true)
    expect(fallback.textContent).toBe('2h')
    expect(controls.classList.contains('lx-hover-actions')).toBe(true)
    expect(controls.classList.contains('group-focus-within/workbench-row:opacity-100')).toBe(true)
    expect(controls.classList.contains('group-hover/workbench-row:opacity-100')).toBe(true)
    expect(
      controls.classList.contains('group-has-[[data-state=open]]/workbench-actions:opacity-100'),
    ).toBe(true)
    expect(
      fallback.classList.contains('group-has-[[data-state=open]]/workbench-actions:opacity-0'),
    ).toBe(true)
    expect(button.tabIndex).toBe(0)
    expect(button.getAttribute('aria-label')).toBe('Conversation actions')
    await React.act(async () => {
      button.focus()
      button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(button.dataset.state).toBe('open')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    await React.act(async () => {
      document.querySelector<HTMLElement>('[role="menuitem"]')!.click()
    })
    expect(picked).toBe(true)
    expect(button.dataset.state).toBe('closed')
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
  }
})
