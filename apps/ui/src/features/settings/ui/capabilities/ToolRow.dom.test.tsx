import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { CapabilityToolRow } from '../../model/useCapabilityTools'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('the required protocol cannot be disabled while ordinary tools remain configurable', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ToolRow } = await import('./ToolRow')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const changes: boolean[] = []
  const tool: CapabilityToolRow = {
    name: 'set_topic',
    label: 'Session topic',
    description: '',
    category: 'conversation',
    enabled: true,
    required: true,
  }
  try {
    await act(async () =>
      root.render(<ToolRow tool={tool} busy={false} onToggle={(value) => changes.push(value)} />),
    )
    const required = container.querySelector('input')!
    expect(required.disabled).toBe(true)
    expect(required.getAttribute('aria-label')).toBe('Session topic (required)')
    expect(container.textContent).toContain('Required')
    await act(async () => required.click())
    expect(changes).toEqual([])
    await act(async () =>
      root.render(
        <ToolRow
          tool={{ ...tool, name: 'read', label: 'Read', required: false }}
          busy={false}
          onToggle={(value) => changes.push(value)}
        />,
      ),
    )
    await act(async () => container.querySelector('input')!.click())
    expect(changes).toEqual([false])
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
