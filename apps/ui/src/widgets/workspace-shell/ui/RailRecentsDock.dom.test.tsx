import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { RailRecentsSlotApi } from './RailRecentsDock'
import type { RailEntry } from './shellTypes'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

afterEach(async () => {
  const { setRailRecentsMode, DEFAULT_RAIL_RECENTS_MODE } =
    await import('@/shared/lib/railRecentsPref')
  setRailRecentsMode(DEFAULT_RAIL_RECENTS_MODE)
})

function entry(id: string, label: string, active = false): RailEntry {
  return { id, icon: null, label, active, onClick: () => {} }
}

/** Slot labels rendered INSIDE the rail (the flyout portals out of it). */
function railLabels(host: HTMLElement): (string | null)[] {
  return Array.from(host.querySelectorAll<HTMLElement>('button')).map((slot) =>
    slot.getAttribute('aria-label'),
  )
}

/** Slot labels inside the OPEN flyout only — a closed one force-mounts in tests. */
function flyoutLabels(): (string | null)[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-slot="popover-content"][data-state="open"] button',
    ),
  ).map((slot) => slot.getAttribute('aria-label'))
}

// The whole point of the dock: recents rest behind one button, and the icons come
// back on demand. Without these the feature's noise budget is unenforced — any
// change that leaks three mini app icons back into the rail would pass silently.
describe('RailRecentsDock', () => {
  /** Last slot API the dock handed out — the seam a real context menu wires into. */
  const slotApi: { current: RailRecentsSlotApi | null } = { current: null }
  const reportSlotMenu = (open: boolean) => slotApi.current?.onMenuOpenChange(open)

  async function mount(entries: RailEntry[], dragging = false) {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { RailRecentsDock } = await import('./RailRecentsDock')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const render = (nextEntries: RailEntry[], nextDragging = dragging) =>
      act(async () =>
        root.render(
          <RailRecentsDock
            entries={nextEntries}
            dragging={nextDragging}
            renderEntry={(item) => <button key={item.id} type="button" aria-label={item.label} />}
          />,
        ),
      )
    await render(entries)
    return {
      host,
      render,
      act,
      cleanup: async () => {
        await act(async () => root.unmount())
        host.remove()
      },
    }
  }

  test('collapses every recent behind one trigger and reveals them on click', async () => {
    const { host, render, act, cleanup } = await mount([
      entry('reader', 'Reader'),
      entry('office', 'Office'),
      entry('db', 'Database', true),
    ])
    try {
      // ONE slot, whatever the history holds — the active view included, or opening
      // a view would silently grow the rail by an icon.
      expect(railLabels(host)).toEqual(['Recent views (3), showing Database'])
      expect(flyoutLabels()).toEqual([])

      const trigger = host.querySelector<HTMLButtonElement>('[data-rail-recents-trigger]')!
      // "You are here" rides on the trigger instead: active accent, not a new icon.
      expect(trigger.getAttribute('aria-current')).toBe('true')
      await render([entry('reader', 'Reader'), entry('office', 'Office'), entry('db', 'Database')])
      expect(railLabels(host)).toEqual(['Recent views (3)'])
      expect(
        host.querySelector('[data-rail-recents-trigger]')?.getAttribute('aria-current'),
      ).toBeNull()
      await render([
        entry('reader', 'Reader'),
        entry('office', 'Office'),
        entry('db', 'Database', true),
      ])
      await act(async () => trigger.click())
      expect(flyoutLabels()).toEqual(['Reader', 'Office', 'Database'])

      // Clicking again puts it away.
      await act(async () => trigger.click())
      expect(flyoutLabels()).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test('hovering the trigger opens the flyout after the intent delay', async () => {
    const { host, act, cleanup } = await mount([entry('reader', 'Reader')])
    try {
      const trigger = host.querySelector<HTMLButtonElement>('[data-rail-recents-trigger]')!
      // React derives onPointerEnter from the native pointerover event.
      await act(async () => {
        trigger.dispatchEvent(new Event('pointerover', { bubbles: true }))
      })
      // Intent delay: a pointer merely crossing the trigger opens nothing.
      expect(flyoutLabels()).toEqual([])
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
      })
      expect(flyoutLabels()).toEqual(['Reader'])
    } finally {
      await cleanup()
    }
  })

  // Right-clicking a slot used to shut the flyout before the menu could be read:
  // the menu portals out of the popover, so opening it looked like an interaction
  // outside, and dismissing the popover took the menu's own trigger with it.
  test('a slot context menu holds the flyout open, hover-out included', async () => {
    const { host, act, cleanup } = await mount([entry('reader', 'Reader')])
    try {
      const trigger = host.querySelector<HTMLButtonElement>('[data-rail-recents-trigger]')!
      await act(async () => trigger.click())
      const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')!
      await act(async () => reportSlotMenu(true))

      // The pointer travels off the flyout and onto the menu: still open, and the
      // close timer never even gets scheduled.
      await act(async () => {
        content.dispatchEvent(new Event('pointerout', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 300))
      })
      expect(flyoutLabels()).toEqual(['Reader'])

      // The menu closes (an item was chosen, or Escape): the icons stay up rather
      // than being snatched away mid-gesture.
      await act(async () => reportSlotMenu(false))
      expect(flyoutLabels()).toEqual(['Reader'])
    } finally {
      await cleanup()
    }
  })

  test('a rail drag shuts the flyout so it cannot eat the drop', async () => {
    const { host, render, act, cleanup } = await mount([entry('reader', 'Reader')])
    try {
      const trigger = host.querySelector<HTMLButtonElement>('[data-rail-recents-trigger]')!
      await act(async () => trigger.click())
      expect(flyoutLabels()).toEqual(['Reader'])
      await render([entry('reader', 'Reader')], true)
      expect(flyoutLabels()).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test('expanded mode drops the trigger; off mode drops the dock entirely', async () => {
    const { setRailRecentsMode } = await import('@/shared/lib/railRecentsPref')
    const { host, render, act, cleanup } = await mount([
      entry('reader', 'Reader'),
      entry('office', 'Office'),
    ])
    try {
      await act(async () => setRailRecentsMode('expanded'))
      expect(railLabels(host)).toEqual(['Reader', 'Office'])
      expect(host.querySelector('[data-rail-recents-trigger]')).toBeNull()

      await act(async () => setRailRecentsMode('off'))
      expect(railLabels(host)).toEqual([])
      // Not even the hairline: an empty dock leaves no trace in the rail.
      expect(host.children).toHaveLength(0)

      // Switching back restores the slots — the MRU list was never touched.
      await act(async () => setRailRecentsMode('hover'))
      await render([entry('reader', 'Reader'), entry('office', 'Office')])
      expect(railLabels(host)).toEqual(['Recent views (2)'])
    } finally {
      await cleanup()
    }
  })
})
