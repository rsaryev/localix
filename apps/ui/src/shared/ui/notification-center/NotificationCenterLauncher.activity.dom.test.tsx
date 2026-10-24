import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { MiniAppStoreActivityRecord } from '@localixai/api/client'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const restores: Array<() => void> = []
afterEach(() => restores.splice(0).forEach((restore) => restore()))

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

/** The bell as it sits in the titlebar, over servers that report `activity`. */
async function mountBell(activity: MiniAppStoreActivityRecord) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { SWRConfig } = await import('swr')
  const { backendClient } = await import('@/shared/api/client')
  const { localModelsApi } = await import('@/shared/api/localModelsApi')
  const { pluginUpdatesApi } = await import('@/shared/api/plugin-updates-client')
  const { resetNotificationsForTests } = await import('@/shared/lib/notifications/store')
  const { NotificationCenterLauncher } = await import('./NotificationCenterLauncher')
  resetNotificationsForTests()
  const spies = [
    spyOn(backendClient, 'getMiniAppStoreActivity').mockResolvedValue(activity),
    spyOn(pluginUpdatesApi, 'list').mockResolvedValue(null),
    spyOn(localModelsApi, 'status').mockResolvedValue({
      jobs: [],
      paused: [],
      installed: [],
      running: [],
    } as never),
  ]
  restores.push(() => spies.forEach((spy) => spy.mockRestore()))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter>
          <NotificationCenterLauncher />
        </MemoryRouter>
      </SWRConfig>,
    )
    await settle()
  })
  const bell = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
  return {
    host,
    bell,
    open: () =>
      React.act(async () => {
        bell().click()
        await settle()
      }),
    unmount: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('the bell while something runs in the background', () => {
  test('says how many tasks are in progress and draws how far they are', async () => {
    const view = await mountBell({
      jobs: [
        {
          name: 'sample-git',
          displayName: 'Git',
          kind: 'install',
          phase: 'downloading',
          received: 1,
          total: 2,
        },
        { name: 'kanban', displayName: 'Kanban', kind: 'install', phase: 'queued' },
      ],
      updates: [],
    })
    expect(view.bell().getAttribute('aria-label')).toBe('Event Center, 2 tasks in progress')
    expect(view.bell().querySelector('[data-activity-ring]')).not.toBeNull()

    await view.open()
    const section = document.body.querySelector('section[aria-label="In progress"]')
    expect(section?.textContent).toContain('Git')
    expect(section?.textContent).toContain('Kanban')
    await view.unmount()
  })

  test('with nothing running it is the ordinary bell', async () => {
    const view = await mountBell({ jobs: [], updates: [] })
    expect(view.bell().getAttribute('aria-label')).toBe('Event Center')
    expect(view.bell().querySelector('[data-activity-ring]')).toBeNull()
    await view.unmount()
  })
})
