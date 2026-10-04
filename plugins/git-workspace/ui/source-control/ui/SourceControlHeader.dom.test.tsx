import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { act, type ComponentProps } from 'react'
import { registerDom } from '@localixai/kit/testing'
import { SourceControlHeader } from './SourceControlHeader'
import type { SourceControlStatus } from '../../../backend/source-control/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const status: SourceControlStatus = {
  isRepo: true,
  vcs: 'git',
  root: '/workspace/project',
  branch: 'main',
  detached: false,
  upstream: 'origin/main',
  ahead: 2,
  behind: 1,
  files: [],
  stats: { files: 1, insertions: 8, deletions: 3 },
}

async function mount(overrides: Partial<ComponentProps<typeof SourceControlHeader>> = {}) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const onFetch = mock(() => {})
  const noop = () => {}
  await act(async () =>
    root.render(
      <SourceControlHeader
        status={status}
        loading={false}
        pushing={false}
        pulling={false}
        fetching={false}
        canStash
        stashing={false}
        canNuke
        nuking={false}
        rebaseBusy={false}
        bisectBusy={false}
        onRebaseContinue={noop}
        onRebaseAbort={noop}
        onRebaseSkip={noop}
        onBisectGood={noop}
        onBisectBad={noop}
        onBisectSkip={noop}
        onBisectReset={noop}
        onPush={noop}
        onPull={noop}
        onFetch={onFetch}
        onStash={noop}
        onNuke={noop}
        onRefresh={noop}
        onOpenAllDiff={noop}
        {...overrides}
      />,
    ),
  )
  return {
    host,
    onFetch,
    async openMenu() {
      const trigger = host.querySelector<HTMLButtonElement>(
        '[aria-label="More source control actions"]',
      )!
      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      return document.body.querySelector<HTMLElement>('[role="menu"]')!
    },
    async close() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('source control toolbar', () => {
  test('keeps frequent actions inline and makes secondary actions reachable in the menu', async () => {
    const view = await mount()
    try {
      expect(view.host.querySelector('[data-slot="workbench-toolbar"]')).not.toBeNull()
      expect(view.host.querySelector('[aria-label="Open full diff"]')).not.toBeNull()
      expect(view.host.textContent).not.toContain('Stash all changes')
      const menu = await view.openMenu()
      expect(menu.textContent).toContain('Stash all changes')
      expect(menu.textContent).toContain('Discard all changes…')
      const fetch = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === 'Fetch',
      )!
      await act(async () => fetch.click())
      expect(view.onFetch).toHaveBeenCalledTimes(1)
    } finally {
      await view.close()
    }
  })

  test('prevents competing remote actions while fetching', async () => {
    const view = await mount({ fetching: true })
    try {
      expect(
        view.host.querySelector<HTMLButtonElement>('[aria-label="Push 2 outgoing commits"]')!
          .disabled,
      ).toBe(true)
      expect(
        view.host.querySelector<HTMLButtonElement>('[aria-label="Pull 1 incoming commits"]')!
          .disabled,
      ).toBe(true)
      const menu = await view.openMenu()
      for (const label of ['Fetch', 'Pull', 'Push']) {
        const item = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
          (entry) => entry.textContent === label,
        )!
        expect(item.getAttribute('aria-disabled')).toBe('true')
      }
    } finally {
      await view.close()
    }
  })

  test('offers publishing without an upstream and disables push on detached HEAD', async () => {
    const publishView = await mount({ status: { ...status, upstream: null, ahead: 0, behind: 0 } })
    try {
      expect(publishView.host.querySelector('[aria-label="Publish branch"]')).not.toBeNull()
    } finally {
      await publishView.close()
    }
    const detachedView = await mount({
      status: { ...status, branch: null, detached: true, ahead: 0, behind: 0 },
    })
    try {
      expect(detachedView.host.querySelector('[aria-label="Publish branch"]')).toBeNull()
      const menu = await detachedView.openMenu()
      const push = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === 'Push',
      )!
      expect(push.getAttribute('aria-disabled')).toBe('true')
    } finally {
      await detachedView.close()
    }
  })
})
