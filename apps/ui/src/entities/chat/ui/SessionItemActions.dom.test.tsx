import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns } from '@/testing/settle'

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
    const fallback = slot.querySelector<HTMLElement>(
      '[data-slot="workbench-list-row-action-fallback"]',
    )!
    expect(slot.dataset.visibility).toBe('hover')
    expect(fallback.textContent).toBe('2h')
    expect(button.tabIndex).toBe(0)
    expect(button.getAttribute('aria-label')).toBe('Conversation actions')
    await React.act(async () => {
      button.focus()
      button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await turns()
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
