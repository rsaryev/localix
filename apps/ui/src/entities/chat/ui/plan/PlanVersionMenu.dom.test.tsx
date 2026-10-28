import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { SessionPlan } from '@localixai/api/client'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns as settle } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const plan = (id: string, version: number, status: SessionPlan['status']): SessionPlan => ({
  id,
  sessionId: 'root',
  version,
  status,
  title: `Plan ${version}`,
  body: 'Body',
  approvedMode: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  decidedAt: null,
  completedAt: null,
  completionSummary: null,
  // No snapshot file unless a test gives one: the version rows are what most cases are about.
  filePath: '',
  dismissedBy: null,
})

async function mount(plans: SessionPlan[], current: SessionPlan) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { PlanVersionMenu } = await import('./PlanVersionMenu')
  const picks: string[] = []
  const opened: string[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <PlanVersionMenu
        plans={plans}
        current={current}
        onPick={(id) => picks.push(id)}
        onOpenFile={(path) => opened.push(path)}
      />,
    ),
  )
  return {
    host,
    picks,
    opened,
    open: async () => {
      const trigger = host.querySelector<HTMLButtonElement>('button')!
      await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
    },
    item: (label: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')].find(
        (element) => element.textContent?.startsWith(label),
      ),
    pick: async (element: HTMLElement | undefined) => {
      expect(element).toBeDefined()
      await act(async () => {
        element!.click()
        await settle()
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('PlanVersionMenu — the version this tab shows', () => {
  test('one version is a quiet readout, not a control', async () => {
    const only = plan('p1', 1, 'presented')
    const ui = await mount([only], only)
    try {
      expect(ui.host.querySelector('button')).toBeNull()
      expect(ui.host.textContent).toBe('v1 · waiting for you')
    } finally {
      await ui.unmount()
    }
  })

  test('several versions open the shared menu: status under each name, the shown one checked', async () => {
    const v2 = plan('p2', 2, 'presented')
    const v1 = plan('p1', 1, 'superseded')
    const ui = await mount([v2, v1], v2)
    try {
      await ui.open()
      expect(ui.item('Version 2')?.getAttribute('role')).toBe('menuitemradio')
      expect(ui.item('Version 2')?.getAttribute('aria-checked')).toBe('true')
      expect(ui.item('Version 1')?.getAttribute('aria-checked')).toBe('false')
      expect(ui.item('Version 1')?.textContent).toContain('superseded')
      await ui.pick(ui.item('Version 1'))
      expect(ui.picks).toEqual(['p1'])
    } finally {
      await ui.unmount()
    }
  })

  test('a version with a snapshot file is a menu even alone, and opens that file', async () => {
    const path = '/work/.localix/plans/ROOT/v1.md'
    const only = { ...plan('p1', 1, 'presented'), filePath: path }
    const ui = await mount([only], only)
    try {
      await ui.open()
      // One version: nothing to choose, so no version rows — only the file.
      expect(ui.item('Version 1')).toBeUndefined()
      expect(ui.item('Copy path')).toBeDefined()
      await ui.pick(ui.item('Open v1.md'))
      expect(ui.opened).toEqual([path])
    } finally {
      await ui.unmount()
    }
  })
})
