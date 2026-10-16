import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('CollapsibleStrip', () => {
  test('keeps disclosure and actions independent while collapsed content stays inert', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CollapsibleStrip } = await import('./collapsible-strip')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let actionCalls = 0

    try {
      await act(async () => {
        root.render(
          <CollapsibleStrip
            label={{ expand: 'Show jobs', collapse: 'Hide jobs' }}
            icon={<span>J</span>}
            count={2}
            title="Jobs"
            summary="Build"
            listLabel="Background jobs"
            actionsLabel="Job strip actions"
            actions={
              <button type="button" data-testid="refresh" onClick={() => actionCalls++}>
                Refresh
              </button>
            }
          >
            <div role="listitem">
              <button type="button" data-testid="job">
                Open job
              </button>
            </div>
          </CollapsibleStrip>,
        )
      })

      const trigger = host.querySelector<HTMLButtonElement>(
        '[data-slot="collapsible-strip-trigger"]',
      )
      const action = host.querySelector<HTMLButtonElement>('[data-testid="refresh"]')
      const actionGroup = host.querySelector<HTMLElement>('[data-slot="collapsible-strip-actions"]')
      const content = host.querySelector<HTMLElement>('[data-slot="collapsible-strip-content"]')

      expect(trigger?.tagName).toBe('BUTTON')
      expect(trigger?.contains(action ?? null)).toBe(false)
      expect(action?.tabIndex).toBe(0)
      expect(actionGroup?.getAttribute('role')).toBe('group')
      expect(actionGroup?.getAttribute('aria-label')).toBe('Job strip actions')
      expect(trigger?.getAttribute('aria-controls')).toBe(content?.id)
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')
      expect(content?.getAttribute('role')).toBe('list')
      expect(content?.getAttribute('aria-label')).toBe('Background jobs')
      expect(content?.querySelectorAll('[role="listitem"]')).toHaveLength(1)
      expect(content?.getAttribute('aria-hidden')).toBe('true')
      expect(content?.hasAttribute('inert')).toBe(true)
      expect(content?.querySelector('[data-testid="job"]')).not.toBeNull()

      action?.focus()
      expect(document.activeElement).toBe(action)
      await act(async () => action?.click())
      expect(actionCalls).toBe(1)
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')

      await act(async () => trigger?.click())
      expect(trigger?.getAttribute('aria-expanded')).toBe('true')
      expect(content?.getAttribute('aria-hidden')).toBe('false')
      expect(content?.hasAttribute('inert')).toBe(false)

      await act(async () => trigger?.click())
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')
      expect(content?.hasAttribute('inert')).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('reports controlled expansion without mutating owner state', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CollapsibleStrip } = await import('./collapsible-strip')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const changes: boolean[] = []
    const render = async (expanded: boolean) => {
      await act(async () => {
        root.render(
          <CollapsibleStrip
            expanded={expanded}
            onExpandedChange={(next) => changes.push(next)}
            label={{ expand: 'Show queue', collapse: 'Hide queue' }}
            icon={<span>Q</span>}
            count={1}
            title="Queue"
            listLabel="Queued messages"
          >
            <div role="listitem">Queued work</div>
          </CollapsibleStrip>,
        )
      })
    }

    try {
      await render(false)
      const trigger = host.querySelector<HTMLButtonElement>(
        '[data-slot="collapsible-strip-trigger"]',
      )!
      const content = host.querySelector<HTMLElement>('[data-slot="collapsible-strip-content"]')!

      await act(async () => trigger.click())
      expect(changes).toEqual([true])
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(content.hasAttribute('inert')).toBe(true)

      await render(true)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(content.hasAttribute('inert')).toBe(false)

      await act(async () => trigger.click())
      expect(changes).toEqual([true, false])
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
