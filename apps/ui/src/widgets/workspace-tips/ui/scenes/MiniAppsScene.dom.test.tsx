import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { registerInspectorHandler } from '@/shared/lib/inspectorBus'
import type { InspectorRequest } from '@/shared/lib/inspectorBusContracts'
import { isSetupOpen, openSetup } from '@/shared/lib/setupDialog'
import { storeEntry } from '@/testing/miniAppStore'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())
const restores: Array<() => void> = []
afterEach(() => restores.splice(0).forEach((restore) => restore()))

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

/** The store as a new installation sees it: the recommended apps arriving on their own. */
const ENTRIES = [
  storeEntry({
    name: 'sample-git',
    displayName: 'Git',
    recommended: true,
    job: { phase: 'downloading', received: 1, total: 2 },
  }),
  storeEntry({ name: 'documents', displayName: 'Documents', recommended: true, installed: {} }),
  storeEntry({
    name: 'kanban',
    displayName: 'Kanban',
    recommended: true,
    job: { phase: 'queued' },
  }),
  storeEntry({ name: 'chess', displayName: 'Chess', featured: true }),
  storeEntry({ name: 'reader', displayName: 'Reader', installed: {} }),
  storeEntry({ name: 'notes', publisher: { name: 'Ada', verified: false } }),
]

async function mountPick() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { backendClient } = await import('@/shared/api/client')
  const installs: string[] = []
  const spies = [
    spyOn(backendClient, 'listMiniAppStore').mockResolvedValue({ entries: ENTRIES, problems: [] }),
    spyOn(backendClient, 'installMiniApp').mockImplementation(async (name: string) => {
      installs.push(name)
    }),
  ]
  restores.push(() => spies.forEach((spy) => spy.mockRestore()))
  const { WORKSPACE_TIPS } = await import('../workspaceTips')
  const Action = WORKSPACE_TIPS.find((entry) => entry.id === 'mini-apps')!.Action!
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Action />
      </SWRConfig>,
    )
    await settle()
  })
  const items = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  const item = (label: string) => items().find((row) => row.textContent?.includes(label))
  return {
    host,
    installs,
    items,
    item,
    open: () =>
      React.act(async () => {
        const trigger = host.querySelector<HTMLButtonElement>('button')!
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      }),
    choose: (row: HTMLElement | undefined) =>
      React.act(async () => {
        row?.click()
        await settle()
      }),
    unmount: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

test('the slide names the apps that install on their own, and its pick never leaves setup', async () => {
  const opened: InspectorRequest[] = []
  const unregister = registerInspectorHandler((request) => void opened.push(request))
  openSetup()
  const view = await mountPick()
  try {
    expect(view.host.textContent).toContain('Git, Documents and Kanban')
    await view.open()

    // The recommended apps, each with where it stands now.
    expect(view.item('Git')?.textContent).toContain('Installing 50%')
    expect(view.item('Documents')?.textContent).toContain('Installed')
    expect(view.item('Kanban')?.textContent).toContain('Waiting')
    // A few more of Localix's own to add, but none already here and none from someone else.
    expect(view.item('Chess')?.textContent).toContain('Install')
    expect(view.item('Reader')).toBeUndefined()
    expect(view.item('notes')).toBeUndefined()

    await view.choose(view.item('Chess'))
    expect(view.installs).toEqual(['chess'])
    expect(isSetupOpen()).toBe(true)

    // The store is the last, quiet way out — and setup stays where it is.
    expect(view.items().at(-1)?.textContent).toContain('Open the store')
    await view.choose(view.item('Open the store'))
    expect(opened).toEqual([expect.objectContaining({ workKind: 'mini-app-store' })])
    expect(isSetupOpen()).toBe(true)
  } finally {
    unregister()
    await view.unmount()
  }
})
