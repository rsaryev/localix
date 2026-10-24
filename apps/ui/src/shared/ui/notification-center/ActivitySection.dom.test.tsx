import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ActivityItem, UpdateOffer } from '@/shared/lib/background-activity/activityItems'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

async function mount(items: ActivityItem[], updates: UpdateOffer[]) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ActivitySection } = await import('./ActivitySection')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(<ActivitySection items={items} updates={updates} />))
  return {
    host,
    button: (name: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.getAttribute('aria-label') === name || b.textContent?.trim() === name,
      ),
    unmount: async () => {
      await React.act(async () => root.unmount())
      host.remove()
    },
  }
}

const calls: string[] = []
const download: ActivityItem = {
  id: 'mini-app:sample-git',
  kind: 'mini-app',
  name: 'Git',
  status: 'Downloading · 1.0 KB of 4.0 KB',
  percent: 25,
  state: 'running',
  icon: '/rpc/mini-apps/store/media/sample-git/icon?v=1',
  actions: [{ id: 'store', label: 'Open the store', run: () => calls.push('store') }],
}
const model: ActivityItem = {
  id: 'local-model:gemma',
  kind: 'local-model',
  name: 'Gemma 4',
  status: 'Paused · 40%',
  percent: 40,
  state: 'paused',
  actions: [
    { id: 'resume', label: 'Resume download', run: () => calls.push('resume') },
    { id: 'cancel', label: 'Cancel download', run: () => calls.push('cancel') },
  ],
}
const plugins: UpdateOffer = {
  id: 'plugins',
  title: '3 plugin updates',
  detail: 'review, lint and docs',
  fingerprint: 'x',
  action: { id: 'update-all', label: 'Update all', run: () => calls.push('update plugins') },
}

describe('the Event Center’s In progress section', () => {
  test('shows nothing at all when nothing runs and nothing is offered', async () => {
    const view = await mount([], [])
    expect(view.host.textContent).toBe('')
    await view.unmount()
  })

  test('each job: its icon, name, what is happening, how far, and what can be done', async () => {
    calls.length = 0
    const view = await mount([download, model], [])
    const section = view.host.querySelector('section[aria-label="In progress"]')!
    expect(section.textContent).toContain('Git')
    expect(section.textContent).toContain('Downloading · 1.0 KB of 4.0 KB')
    expect(section.querySelector('img')?.getAttribute('src')).toContain('sample-git/icon')
    const bars = [...section.querySelectorAll('[role="progressbar"]')]
    expect(bars.map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['25', '40'])
    expect(bars[0]?.getAttribute('aria-label')).toBe('Git progress')
    view.button('Open the store')?.click()
    view.button('Resume download')?.click()
    view.button('Cancel download')?.click()
    expect(calls).toEqual(['store', 'resume', 'cancel'])
    await view.unmount()
  })

  test('a job that cannot say how far it is has a bar with no value', async () => {
    const view = await mount([{ ...download, percent: null, status: 'Installing' }], [])
    const bar = view.host.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBeNull()
    expect(bar.getAttribute('aria-valuetext')).toBe('Installing')
    await view.unmount()
  })

  test('updates on offer are listed below, each with its one action', async () => {
    calls.length = 0
    const view = await mount([], [plugins])
    const section = view.host.querySelector('section[aria-label="Updates"]')!
    expect(section.textContent).toContain('3 plugin updates')
    expect(section.textContent).toContain('review, lint and docs')
    view.button('Update all')?.click()
    expect(calls).toEqual(['update plugins'])
    await view.unmount()
  })

  test('an update that runs shows its progress in place of its action', async () => {
    const view = await mount(
      [],
      [
        {
          ...plugins,
          action: undefined,
          running: { percent: 50, status: 'Updating plugins · 1 of 2' },
        },
      ],
    )
    expect(view.host.textContent).toContain('Updating plugins · 1 of 2')
    expect(view.button('Update all')).toBeUndefined()
    expect(view.host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '50',
    )
    await view.unmount()
  })
})
