import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

import type { ReaderPreferences } from './model'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ReaderAppearanceMenu', () => {
  test('is a menu of picks: size steps in place, each dimension a submenu with its value', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ReaderAppearanceMenu } = await import('./ReaderAppearanceMenu')
    const { DEFAULT_READER_PREFERENCES } = await import('./model')
    const changes: ReaderPreferences[] = []
    const preferences: ReaderPreferences = { ...DEFAULT_READER_PREFERENCES, speedReadingWpm: 350 }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () =>
        root.render(
          <ReaderAppearanceMenu
            preferences={preferences}
            onChange={(next) => changes.push(next)}
          />,
        ),
      )
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Reading appearance"]',
      )!
      await act(async () => {
        trigger.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
        )
        trigger.click()
        await settle()
      })
      const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
      expect(menu.textContent).toContain('Text size · 18px')
      // No segmented control survives inside the menu.
      expect(menu.querySelector('[role="radiogroup"]')).toBeNull()

      const row = (label: string) =>
        [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
          item.textContent?.startsWith(label),
        )!
      expect(row('Typeface').textContent).toContain('Sans')
      expect(row('Reading focus').textContent).toContain('Off')
      // A stored pace that is no preset still shows as the current pick.
      expect(row('Speed reading pace').textContent).toContain('Custom 350')

      // A size step keeps the menu open.
      await act(async () => {
        row('Larger').click()
        await settle()
      })
      expect(changes.at(-1)?.fontSize).toBe(19)
      expect(document.body.querySelector('[role="menu"]')).not.toBeNull()

      await act(async () => {
        row('Typeface').click()
        await settle()
      })
      const faces = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      expect(faces.map((face) => face.textContent)).toEqual(['Sans', 'Serif', 'Mono'])
      expect(faces[0]!.getAttribute('aria-checked')).toBe('true')
      await act(async () => {
        faces[1]!.click()
        await settle()
      })
      expect(changes.at(-1)).toEqual({ ...preferences, fontFamily: 'serif' })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
