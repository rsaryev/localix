import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'

import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

describe('McpToolToggles', () => {
  test('renders a sorted scrollable inventory and toggles either state', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { McpToolToggles } = await import('./McpToolToggles')
    const onToolEnabled = mock(() => {})
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <McpToolToggles
          serverName="filesystem"
          availableTools={['write', 'read', 'write']}
          activeTools={['read']}
          onToolEnabled={onToolEnabled}
        />,
      )
    })

    const list = container.querySelector('[aria-label="filesystem tools"]')
    expect(list?.className).toContain('overflow-y-auto')
    expect([...container.querySelectorAll('code')].map((node) => node.textContent)).toEqual([
      'read',
      'write',
    ])

    const read = container.querySelector<HTMLInputElement>(
      '[role="switch"][aria-label="Disable filesystem tool read"]',
    )
    const write = container.querySelector<HTMLInputElement>(
      '[role="switch"][aria-label="Enable filesystem tool write"]',
    )
    expect(read?.getAttribute('aria-checked')).toBe('true')
    expect(write?.getAttribute('aria-checked')).toBe('false')

    await act(async () => write?.click())
    expect(onToolEnabled).toHaveBeenCalledWith('write', true)

    await act(async () => root.unmount())
  })
})
