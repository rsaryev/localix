import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { StoreActivity } from '@localixai/store'

// Zero-delay timer turns: the code under test schedules with `setTimeout(..., 0)`.
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const restores: Array<() => void> = []
afterEach(() => restores.splice(0).forEach((restore) => restore()))

/** The bell as it sits in the titlebar, over servers that report `activity`. */
async function mountBell(activity: StoreActivity) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { SWRConfig } = await import('swr')
  const { storeApi } = await import('@/shared/api/store-client')
  const { localModelsApi } = await import('@/shared/api/localModelsApi')
  const { resetNotificationsForTests } = await import('@/shared/lib/notifications/store')
  const { NotificationCenterLauncher } = await import('./NotificationCenterLauncher')
  resetNotificationsForTests()
  const spies = [
    spyOn(storeApi, 'activity').mockResolvedValue(activity),
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
          ref: { kind: 'mini-app', id: 'sample-git' },
          displayName: 'Git',
          action: 'install',
          phase: 'downloading',
          received: 1,
          total: 2,
        },
        {
          ref: { kind: 'plugin', id: 'review@localix' },
          displayName: 'Review',
          action: 'install',
          phase: 'queued',
        },
      ],
      updates: [],
    })
    expect(view.bell().getAttribute('aria-label')).toBe('Event Center, 2 tasks in progress')
    expect(view.bell().querySelector('[data-activity-ring]')).not.toBeNull()

    await view.open()
    const section = document.body.querySelector('section[aria-label="In progress"]')
    expect(section?.textContent).toContain('Git')
    expect(section?.textContent).toContain('Review')
    await view.unmount()
  })

  test('with nothing running it is the ordinary bell', async () => {
    const view = await mountBell({ jobs: [], updates: [] })
    expect(view.bell().getAttribute('aria-label')).toBe('Event Center')
    expect(view.bell().querySelector('[data-activity-ring]')).toBeNull()
    await view.unmount()
  })
})
