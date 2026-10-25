import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { McpServerRecord } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const server = {
  id: 'mcp-1',
  name: 'github',
  description: 'Issues and pull requests',
  transport: 'http',
  projectId: '',
  enabled: true,
  oauthStatus: 'none',
  config: { url: 'https://mcp.example.com/?key=hunter2', headers: { Authorization: 'Bearer abc' } },
  createdAt: '',
  updatedAt: '',
} as unknown as McpServerRecord

describe('an MCP server row', () => {
  test('switches the server and opens its Store page, and shows nothing it holds', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { McpServerRow } = await import('./McpServerRow')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const calls: string[] = []
    await act(async () =>
      root.render(
        <McpServerRow
          server={server}
          projects={[]}
          busy={false}
          onToggleEnabled={() => calls.push('toggle')}
          onOpen={() => calls.push('open')}
        />,
      ),
    )

    expect(container.textContent).toContain('github')
    expect(container.textContent).not.toMatch(/hunter2|Bearer abc/u)
    const switchEl = container.querySelector('[aria-label="Disable github"]') as HTMLElement
    await act(async () => switchEl.click())
    const open = [...container.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Settings',
    )!
    await act(async () => open.click())
    expect(calls).toEqual(['toggle', 'open'])

    await act(async () => root.unmount())
    container.remove()
  })
})
