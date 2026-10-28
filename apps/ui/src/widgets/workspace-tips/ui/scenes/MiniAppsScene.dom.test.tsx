import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { registerInspectorHandler } from '@/shared/lib/inspectorBus'
import type { InspectorRequest } from '@/shared/lib/inspectorBusContracts'
import { closeSetup, isSetupOpen, openSetup } from '@/shared/lib/setupDialog'
import { answer, listing } from '@/testing/store'
import { turns as settle } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())
const restores: Array<() => void> = []
afterEach(() => {
  restores.splice(0).forEach((restore) => restore())
  // The scene opens Set up Localix; left open it holds back every later dialog in this process.
  closeSetup()
})

/** The store as a new installation sees it: the recommended apps arriving on their own. */
const LISTINGS = [
  listing({
    id: 'sample-git',
    displayName: 'Git',
    recommended: true,
    job: { action: 'install', phase: 'downloading', received: 1, total: 2 },
  }),
  listing({
    id: 'documents',
    displayName: 'Documents',
    recommended: true,
    installs: [{ scope: 'user', enabled: true }],
  }),
  listing({
    id: 'kanban',
    displayName: 'Kanban',
    recommended: true,
    job: { action: 'install', phase: 'queued' },
  }),
  listing({ id: 'chess', displayName: 'Chess', featured: true }),
  listing({ id: 'reader', displayName: 'Reader', installs: [{ scope: 'user', enabled: true }] }),
  listing({ id: 'notes', publisher: { name: 'Ada', verified: false } }),
]

async function mountPick() {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { storeApi } = await import('@/shared/api/store-client')
  const installs: string[] = []
  const spies = [
    spyOn(storeApi, 'page').mockImplementation(async (query) => answer(LISTINGS, query ?? {})),
    spyOn(storeApi, 'install').mockImplementation(async (ref) => {
      installs.push(ref.id)
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
    expect(view.items().at(-1)?.textContent).toContain('Open the Store')
    await view.choose(view.item('Open the Store'))
    expect(opened).toEqual([
      expect.objectContaining({ workKind: 'store', payload: { shelf: 'discover' } }),
    ])
    expect(isSetupOpen()).toBe(true)
  } finally {
    unregister()
    await view.unmount()
  }
})
