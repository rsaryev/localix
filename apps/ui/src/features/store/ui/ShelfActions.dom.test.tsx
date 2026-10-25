import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ItemAction, ShelfPlan } from '@localixai/store'
import { listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const skill = (name: string, authored: 'user' | 'project' = 'user') =>
  listing({
    id: `${authored}:${name}`,
    ref: { kind: 'skill', id: `${authored}:${name}` },
    name,
    displayName: name,
    contents: { skill: 1 },
    authored,
    source: { id: 'skills:yours', label: 'Your skills' },
    installs: [{ scope: authored, enabled: true }],
  })

const ARCHIVE: ItemAction & { kind: 'skill' } = {
  kind: 'skill',
  id: 'archive-unused',
  label: 'Archive unused',
}
const PLAN: ShelfPlan = {
  summary: 'These skills have not been used in a while.',
  items: [
    { ref: { kind: 'skill', id: 'user:old' }, name: 'old', reason: 'Last used 100 days ago' },
    { ref: { kind: 'skill', id: 'user:idle' }, name: 'idle', reason: 'Never used, 45 days old' },
  ],
}

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')

describe('Archive unused on the Skills shelves', () => {
  test('it previews which skills and why, writes nothing, and archives them once confirmed', async () => {
    const view = await renderStore({
      listings: [skill('old'), skill('idle'), skill('fresh')],
      target: { shelf: 'yours' },
      shelfActions: { user: [ARCHIVE] },
      shelfPlans: { 'skill/archive-unused/user': PLAN },
    })
    try {
      await view.click(view.button('Archive unused'))
      expect(dialog()?.textContent).toContain('old')
      expect(dialog()?.textContent).toContain('Last used 100 days ago')
      expect(dialog()?.textContent).toContain('idle')
      expect(dialog()?.textContent).toContain('Never used, 45 days old')
      expect(dialog()?.textContent).not.toContain('fresh')
      expect(view.calls).toEqual([])

      await view.click(view.button('Archive unused', dialog()!))

      expect(view.calls).toEqual(['shelf-run skill archive-unused user user:old,user:idle'])
      expect(dialog()).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('cancelling leaves everything as it was', async () => {
    const view = await renderStore({
      listings: [skill('old')],
      target: { shelf: 'yours' },
      shelfActions: { user: [ARCHIVE] },
      shelfPlans: { 'skill/archive-unused/user': PLAN },
    })
    try {
      await view.click(view.button('Archive unused'))
      await view.click(view.button('Cancel', dialog()!))
      expect(view.calls).toEqual([])
      expect(dialog()).toBeNull()
    } finally {
      await view.done()
    }
  })

  test('with nothing unused the preview says so and cannot be confirmed', async () => {
    const view = await renderStore({
      listings: [skill('fresh')],
      target: { shelf: 'yours' },
      shelfActions: { user: [ARCHIVE] },
      shelfPlans: { 'skill/archive-unused/user': { summary: 'Nothing is unused.', items: [] } },
    })
    try {
      await view.click(view.button('Archive unused'))
      expect(dialog()?.textContent).toContain('Nothing is unused.')
      expect(view.button('Archive unused', dialog()!)?.hasAttribute('disabled')).toBe(true)
    } finally {
      await view.done()
    }
  })

  test('the Project shelf previews and archives the open project’s skills', async () => {
    const view = await renderStore({
      listings: [skill('deploy', 'project')],
      target: { shelf: 'project' },
      project: { id: 'p1', name: 'Atlas' },
      shelfActions: { project: [ARCHIVE] },
      shelfPlans: {
        'skill/archive-unused/project': {
          summary: 'Unused in this project.',
          items: [
            {
              ref: { kind: 'skill', id: 'project:deploy' },
              name: 'deploy',
              reason: 'Last used 120 days ago',
            },
          ],
        },
      },
    })
    try {
      await view.click(view.button('Archive unused'))
      await view.click(view.button('Archive unused', dialog()!))
      expect(view.calls).toEqual(['shelf-run skill archive-unused project project:deploy in p1'])
    } finally {
      await view.done()
    }
  })

  test('a shelf nothing can be done to shows no button', async () => {
    const view = await renderStore({ listings: [skill('old')], target: { shelf: 'yours' } })
    try {
      expect(view.button('Archive unused')).toBeUndefined()
    } finally {
      await view.done()
    }
  })

  test('a skill’s page says how long it has been idle and offers Pin to keep it', async () => {
    const view = await renderStore({
      listings: [skill('old')],
      target: { ref: { kind: 'skill', id: 'user:old' } },
      notices: {
        'user:old': {
          text: 'Not used for 95 days. Archived on 15 Jun 2026 unless pinned.',
          action: { id: 'pin', label: 'Pin' },
        },
      },
    })
    try {
      const notice = view.host.querySelector<HTMLElement>('[data-slot="workbench-notice-bar"]')
      expect(notice?.textContent).toContain('Not used for 95 days. Archived on 15 Jun 2026')
      await view.click(view.button('Pin', notice!))
      expect(view.calls).toEqual(['action skill/user:old user pin'])
    } finally {
      await view.done()
    }
  })

  test('a skill used lately has no notice', async () => {
    const view = await renderStore({
      listings: [skill('old')],
      target: { ref: { kind: 'skill', id: 'user:old' } },
    })
    try {
      expect(view.host.querySelector('[data-slot="workbench-notice-bar"]')).toBeNull()
    } finally {
      await view.done()
    }
  })
})
