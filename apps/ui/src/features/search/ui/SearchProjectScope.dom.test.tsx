import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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

describe('SearchProjectScope — where the search looks, at the end of the field', () => {
  test('names the current project first, lists the others, and searches every project', async () => {
    const { act, useState } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { SearchProjectScope } = await import('./SearchProjectScope')
    const seen: Array<string | null> = []
    function Harness() {
      const [scope, setScope] = useState<string | null>(null)
      return (
        <SearchProjectScope
          currentProjectId="p2"
          projects={[
            { id: 'p1', name: 'site' },
            { id: 'p2', name: 'localix' },
            { id: 'p3', name: 'api' },
          ]}
          scope={scope}
          onChange={(next) => {
            seen.push(next)
            setScope(next)
          }}
        />
      )
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const open = async (trigger: HTMLElement) =>
      act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await settle()
      })
    const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    try {
      await act(async () => root.render(<Harness />))
      const trigger = host.querySelector<HTMLButtonElement>('button')!
      expect(trigger.textContent).toBe('localix')
      await open(trigger)
      expect(items().map((item) => item.textContent)).toEqual([
        'localix',
        'api',
        'site',
        'All projects',
      ])
      await act(async () => {
        items()
          .find((item) => item.textContent === 'api')!
          .click()
        await settle()
      })
      expect(trigger.textContent).toBe('api')
      await open(trigger)
      await act(async () => {
        items()
          .find((item) => item.textContent === 'All projects')!
          .click()
        await settle()
      })
      expect(seen).toEqual(['p3', 'all'])
      expect(trigger.getAttribute('aria-label')).toBe('Search in: All projects')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
