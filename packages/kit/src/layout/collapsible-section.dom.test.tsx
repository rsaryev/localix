import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('CollapsibleSection', () => {
  test('toggles through a native disclosure without capturing sibling actions', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CollapsibleSection } = await import('./collapsible-section')
    const host = document.createElement('div')
    const root = createRoot(host)
    let actionCalls = 0

    try {
      await act(async () => {
        root.render(
          <CollapsibleSection
            title="Changes"
            actions={
              <button type="button" data-testid="refresh" onClick={() => actionCalls++}>
                Refresh
              </button>
            }
          >
            <span data-testid="content">content</span>
          </CollapsibleSection>,
        )
      })

      const trigger = host.querySelector<HTMLButtonElement>(
        '[data-slot="collapsible-section-trigger"]',
      )
      const action = host.querySelector<HTMLButtonElement>('[data-testid="refresh"]')
      const actionGroup = host.querySelector<HTMLElement>(
        '[data-slot="collapsible-section-actions"]',
      )

      expect(trigger?.tagName).toBe('BUTTON')
      expect(trigger?.contains(action ?? null)).toBe(false)
      expect(actionGroup?.getAttribute('role')).toBe('group')
      expect(actionGroup?.getAttribute('aria-label')).toBe('Changes actions')
      expect(host.querySelector('[data-testid="content"]')).not.toBeNull()

      await act(async () => action?.click())
      expect(actionCalls).toBe(1)
      expect(trigger?.getAttribute('aria-expanded')).toBe('true')
      expect(host.querySelector('[data-testid="content"]')).not.toBeNull()

      await act(async () => trigger?.click())
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')
      expect(host.querySelector('[data-testid="content"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('drags from the current rendered height and resets on double click', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CollapsibleSection } = await import('./collapsible-section')
    const host = document.createElement('div')
    const root = createRoot(host)
    localStorage.removeItem('localix_section_height:resize-test')

    try {
      await act(async () => {
        root.render(
          <CollapsibleSection title="Changes" resizable resizeStorageKey="resize-test">
            <span>content</span>
          </CollapsibleSection>,
        )
      })

      const sash = host.querySelector<HTMLElement>('[aria-label="Resize Changes section"]')
      const section = sash?.parentElement
      expect(sash).not.toBeNull()
      expect(section).not.toBeNull()
      if (!sash || !section) return
      section.getBoundingClientRect = () =>
        ({ height: 100 }) as unknown as ReturnType<Element['getBoundingClientRect']>

      await act(async () => {
        sash.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }))
        window.dispatchEvent(new MouseEvent('pointermove', { clientY: 160 }))
        window.dispatchEvent(new MouseEvent('pointerup'))
      })

      expect(section.style.height).toBe('160px')
      expect(localStorage.getItem('localix_section_height:resize-test')).toBe('160')

      await act(async () => {
        sash.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      expect(section.style.height).toBe('176px')
      await act(async () => {
        sash.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      })
      expect(section.style.height).toBe('160px')

      await act(async () => sash.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      expect(section.style.height).toBe('')
      expect(localStorage.getItem('localix_section_height:resize-test')).toBeNull()
    } finally {
      await act(async () => root.unmount())
    }
  })
})
