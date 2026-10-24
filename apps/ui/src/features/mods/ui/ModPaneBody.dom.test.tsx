import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ModPaneRef } from '@/shared/api/modsApi'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const pane: ModPaneRef = {
  instance: 'gauge@p1',
  plugin: 'gauge',
  id: 'steps',
  title: 'Steps',
  cwd: '/work/shop',
  closeOnEscape: true,
  focusRequest: 1,
}

async function mount(panes: ModPaneRef[]) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { modsApi } = await import('@/shared/api/modsApi')
  const { useGridStore } = await import('@/entities/workspace-grid/model')
  const { ModPaneBody } = await import('./ModPaneBody')
  const { workItemKindRegistry } = await import('@/shared/contrib/uiContrib')
  workItemKindRegistry.register({
    kind: 'mod-pane',
    Component: () => null,
    Icon: () => null,
    scope: 'global',
  })
  const calls: string[] = []
  const spies = [
    spyOn(modsApi, 'overview').mockImplementation(async () => ({ mods: [], panes, failures: {} })),
    spyOn(modsApi, 'pane').mockImplementation(async (instance, id) => ({
      instance,
      plugin: 'gauge',
      id,
      tree: [
        { type: 'Text', props: { bold: true }, children: ['Step 1 of 2'] },
        { type: 'Button', props: { key: 'next', label: 'Next', hotkey: 'n' }, children: [] },
      ],
    })),
    spyOn(modsApi, 'act').mockImplementation(async (_instance, _id, action) => {
      calls.push(`act:${action.element}`)
    }),
    spyOn(modsApi, 'close').mockImplementation(async (_instance, id) => {
      calls.push(`close:${id}`)
    }),
  ]
  const item = {
    id: 'mod-pane:gauge@p1/steps',
    title: 'steps',
    payload: { instance: 'gauge@p1', paneId: 'steps', plugin: 'gauge' },
  }
  useGridStore.getState().openItem({ kind: 'mod-pane', ...item })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ModPaneBody item={item} />
      </SWRConfig>,
    ),
  )
  await React.act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
  return {
    host,
    calls,
    act: React.act,
    title: () => useGridStore.getState().items[item.id]?.title,
    done: async () => {
      await React.act(async () => root.unmount())
      host.remove()
      for (const spy of spies) spy.mockRestore()
    },
  }
}

test('a pane tab draws its mod’s tree, names itself, and takes hotkeys and Escape', async () => {
  const view = await mount([pane])
  try {
    expect(view.host.textContent).toContain('Step 1 of 2')
    // The plugin and the project the pane belongs to, beside its title.
    expect(view.host.textContent).toContain('gauge · shop')
    expect(view.title()).toBe('Steps')
    const body = view.host.querySelector<HTMLElement>('[role="region"][aria-label="Steps"]')!
    // Asked forward, the pane holds the keyboard.
    expect(document.activeElement).toBe(body)
    await view.act(async () => {
      body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
    })
    await view.act(async () => {
      body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(view.calls).toEqual(['act:next', 'close:steps'])
  } finally {
    await view.done()
  }
})

test('a tab whose pane is gone says so', async () => {
  const view = await mount([])
  try {
    expect(view.host.textContent).toContain('This pane is closed.')
  } finally {
    await view.done()
  }
})
