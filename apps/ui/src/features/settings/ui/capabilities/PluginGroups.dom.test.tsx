import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { PluginRecord, PluginUpdatesResponse } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const plugin = (name: string, extra: Partial<PluginRecord> = {}): PluginRecord => ({
  name,
  version: '1.0.0',
  description: `${name} plugin`,
  projectId: '',
  scope: 'global',
  dir: `/plugins/${name}`,
  source: `${name}@shop`,
  enabled: true,
  provides: { skills: [], mcpServers: [], commands: [] },
  config: [],
  validation: { errors: [], warnings: [] },
  ...extra,
})

const updates: PluginUpdatesResponse = {
  available: [{ id: 'tool@shop', name: 'tool', marketplace: 'shop', from: '1.0.0', to: '2.0.0' }],
  jobs: [],
  lastCheckedAt: null,
}

describe('the plugin list', () => {
  test('built-in plugins are a group of their own, above the installed ones', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { PluginGroups } = await import('./PluginGroups')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const updated: string[] = []
    try {
      await act(async () =>
        root.render(
          <PluginGroups
            plugins={[
              plugin('tool'),
              plugin('localix-mini-apps', { builtin: true, source: 'builtin' }),
            ]}
            updates={updates}
            renderRow={(p, update) => (
              <li key={p.name} data-plugin={p.name}>
                {p.name}
                {update ? ` ${update.from}→${update.to}` : ''}
                <button type="button" onClick={() => updated.push(p.name)}>
                  go
                </button>
              </li>
            )}
          />,
        ),
      )
      const headings = [...container.querySelectorAll('h3')].map((h) => h.textContent)
      expect(headings).toEqual(['Built-in', 'Installed'])
      const order = [...container.querySelectorAll('[data-plugin]')].map((li) =>
        li.getAttribute('data-plugin'),
      )
      expect(order).toEqual(['localix-mini-apps', 'tool'])
      expect(container.textContent).toContain('tool 1.0.0→2.0.0')
      expect(container.querySelectorAll('[role="list"]')).toHaveLength(2)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('with no built-in plugin there are no group headings', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { PluginGroups } = await import('./PluginGroups')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(
          <PluginGroups
            plugins={[plugin('tool')]}
            updates={undefined}
            renderRow={(p) => <li key={p.name}>{p.name}</li>}
          />,
        ),
      )
      expect(container.querySelectorAll('h3')).toHaveLength(0)
      expect(container.textContent).toBe('tool')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
