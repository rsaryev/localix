import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

import type { McpServerConfig } from '@/shared/api/contracts'
import { emptyDraft } from '../../model/mcpDraft'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('a server can be opted in, and out, as a Claude Code channel', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { McpServerFields } = await import('./McpServerFields')
  const patches: Array<Partial<McpServerConfig>> = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (config: McpServerConfig) =>
    act(() =>
      root.render(
        <McpServerFields
          draft={{ ...emptyDraft(null), config }}
          setDraft={() => {}}
          setConfig={(patch) => patches.push(patch)}
          setTransport={() => {}}
          editingId={null}
          saving={false}
          projects={[]}
        />,
      ),
    )

  await render({ command: ['x'] })
  const toggle = host.querySelector<HTMLInputElement>('[role="switch"]')
  expect(toggle?.checked).toBe(false)
  expect(document.querySelector(`label[for="${toggle?.id}"]`)?.textContent).toBe(
    'Listen as a channel',
  )
  await act(async () => toggle?.click())
  expect(patches).toEqual([{ channel: true }])

  await render({ command: ['x'], channel: true })
  expect(host.querySelector<HTMLInputElement>('[role="switch"]')?.checked).toBe(true)
  await act(async () => host.querySelector<HTMLInputElement>('[role="switch"]')?.click())
  expect(patches.at(-1)).toEqual({ channel: undefined })
  await act(async () => root.unmount())
  host.remove()
})
