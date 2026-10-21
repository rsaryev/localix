import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { Project, UiSession } from '@/shared/api/contracts'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const session = (id: string, projectId: string | null) =>
  ({ id, projectId, isArchived: false, isPinned: false, isUnread: false }) as unknown as UiSession
const project = (id: string, name: string) => ({ id, name }) as unknown as Project

describe('SessionBatchBar move-to-project menu', () => {
  test('lists "No project" and every project as one choice, marking the shared one', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SessionBatchBar } = await import('./SessionBatchBar')
    const onMoveToProject = mock(() => {})
    const noop = () => {}
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <SessionBatchBar
            sessions={[session('a', 'p1'), session('b', 'p1')]}
            projects={[project('p1', 'Alpha'), project('p2', 'Beta')]}
            onArchive={noop}
            onPin={noop}
            onMarkUnread={noop}
            onMoveToProject={onMoveToProject}
            onDelete={noop}
            onClear={noop}
          />,
        )
      })

      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Move to project"]')!
      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
        )
        await settle()
      })

      const rows = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
      expect(rows.map((row) => row.textContent)).toEqual(['No project', 'Alpha', 'Beta'])
      expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual([
        'false',
        'true',
        'false',
      ])

      await act(async () => {
        rows[0].click()
        await settle()
      })
      expect(onMoveToProject).toHaveBeenCalledWith(null)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
