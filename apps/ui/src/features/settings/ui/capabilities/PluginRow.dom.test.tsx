import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ComponentProps } from 'react'
import type { PluginRecord } from '@/shared/api/contracts'
import type { PluginRow as PluginRowComponent } from './PluginRow'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const plugin = (extra: Partial<PluginRecord> = {}): PluginRecord => ({
  name: 'tool',
  version: '1.0.0',
  description: 'A tool',
  projectId: '',
  scope: 'global',
  dir: '/home/.localix/plugins/cache/shop/tool/1.0.0',
  source: 'tool@shop',
  enabled: true,
  provides: { skills: [], mcpServers: [], commands: ['run'] },
  config: [],
  validation: { errors: [], warnings: [] },
  ...extra,
})

async function render(props: Partial<ComponentProps<typeof PluginRowComponent>>) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { PluginRow } = await import('./PluginRow')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const calls: string[] = []
  await act(async () =>
    root.render(
      <PluginRow
        plugin={plugin()}
        projects={[]}
        busy={false}
        busyLabel={null}
        configOpen={false}
        onToggle={() => calls.push('toggle')}
        onRemove={() => calls.push('remove')}
        onUpdate={() => calls.push('update')}
        onToggleConfig={() => calls.push('config')}
        onSaveConfig={() => calls.push('save')}
        {...props}
      />,
    ),
  )
  const button = (name: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
  const cleanup = async () => {
    await act(async () => root.unmount())
    container.remove()
  }
  return { container, calls, button, act, cleanup }
}

describe('a plugin row', () => {
  test('a built-in plugin says so, can be switched off, and offers no uninstall or update', async () => {
    const view = await render({
      plugin: plugin({ name: 'localix-mini-apps', builtin: true, source: 'builtin' }),
      update: { id: 'localix-mini-apps@localix', from: '0.1.0', to: '0.2.0' },
    })
    try {
      expect(view.container.textContent).toContain('Built-in')
      expect(view.button('Remove')).toBeUndefined()
      expect(view.button('Update now')).toBeUndefined()
      const toggle = view.container.querySelector<HTMLInputElement>('input[role="switch"], input')!
      expect(toggle.getAttribute('aria-label')).toBe('Disable localix-mini-apps')
      await view.act(async () => toggle.click())
      expect(view.calls).toEqual(['toggle'])
    } finally {
      await view.cleanup()
    }
  })

  test('an installed plugin with a newer version offers Update now, from → to', async () => {
    const view = await render({ update: { id: 'tool@shop', from: '1.0.0', to: '2.0.0' } })
    try {
      expect(view.container.textContent).toContain('1.0.0 → 2.0.0')
      await view.act(async () => view.button('Update now')!.click())
      expect(view.calls).toEqual(['update'])
      expect(view.button('Remove')).toBeDefined()
    } finally {
      await view.cleanup()
    }
  })

  test('while its update runs, the row says what it is doing and the button waits', async () => {
    const view = await render({
      update: { id: 'tool@shop', from: '1.0.0', to: '2.0.0' },
      updateJob: { phase: 'downloading' },
    })
    try {
      expect(view.container.textContent).toContain('Downloading 2.0.0')
      expect(view.button('Update now')?.disabled).toBe(true)
    } finally {
      await view.cleanup()
    }
  })

  test('a failed update says why', async () => {
    const view = await render({
      update: { id: 'tool@shop', from: '1.0.0', to: '2.0.0' },
      updateJob: { phase: 'failed', error: 'Source path does not exist' },
    })
    try {
      expect(view.container.textContent).toContain('Update failed: Source path does not exist')
      expect(view.button('Update now')?.disabled).toBe(false)
    } finally {
      await view.cleanup()
    }
  })

  test('without an update there is no Update now', async () => {
    const view = await render({})
    try {
      expect(view.button('Update now')).toBeUndefined()
    } finally {
      await view.cleanup()
    }
  })
})
