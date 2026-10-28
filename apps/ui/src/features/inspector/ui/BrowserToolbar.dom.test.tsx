import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { turns as settle } from '@/testing/settle'
import {
  PREVIEW_VIEWPORT_FILL,
  PREVIEW_VIEWPORT_PRESETS,
  rotateViewport,
  type PreviewViewportPreset,
} from '../model/previewViewportPresets'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const preset = (label: string) => PREVIEW_VIEWPORT_PRESETS.find((item) => item.label === label)!

async function mountFrameMenu(current: PreviewViewportPreset) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { FrameSizeMenu } = await import('./BrowserToolbar')
  const changes: PreviewViewportPreset[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(<FrameSizeMenu preset={current} onChange={(next) => changes.push(next)} />),
  )
  return {
    changes,
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

describe('FrameSizeMenu — the page frame pick', () => {
  test('sizes are radio rows with a device icon and the size as the hint', async () => {
    const ui = await mountFrameMenu(PREVIEW_VIEWPORT_FILL)
    try {
      await ui.open()
      const fill = ui.item('Responsive')
      expect(fill?.getAttribute('role')).toBe('menuitemradio')
      expect(fill?.getAttribute('aria-checked')).toBe('true')
      expect(fill?.textContent).toBe('ResponsiveFill panel')

      const phone = ui.item('iPhone SE')
      expect(phone?.getAttribute('aria-checked')).toBe('false')
      expect(phone?.textContent).toBe('iPhone SE375 × 667')
      // Icon kept in front: the radio mark is at the END, so the leading glyph survives.
      expect(phone?.querySelector('svg.lucide-smartphone')).not.toBeNull()
      expect(ui.item('Desktop')?.querySelector('svg.lucide-monitor')).not.toBeNull()

      // The fill preset has no axes to swap, so there is nothing to rotate.
      expect(ui.item('Rotate frame')).toBeUndefined()

      await ui.pick(phone)
      expect(ui.changes).toEqual([preset('iPhone SE')])
    } finally {
      await ui.unmount()
    }
  })

  test('a rotated fixed frame stays checked and offers Rotate frame as an action', async () => {
    const rotated = rotateViewport(preset('iPad Mini'))
    const ui = await mountFrameMenu(rotated)
    try {
      await ui.open()
      expect(ui.item('iPad Mini')?.getAttribute('aria-checked')).toBe('true')
      const rotate = ui.item('Rotate frame')
      expect(rotate?.getAttribute('role')).toBe('menuitem')
      await ui.pick(rotate)
      expect(ui.changes).toEqual([preset('iPad Mini')])
    } finally {
      await ui.unmount()
    }
  })
})
