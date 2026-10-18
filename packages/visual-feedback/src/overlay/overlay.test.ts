/**
 * The overlay follows what it outlines. Positions were read on scroll and resize only, so a
 * framework re-render left a comment's tint on an element that no longer existed.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { createOverlay } from './index'
import { VF_IGNORE_ATTR } from '../protocol/index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

const mark = { id: 'c1', selector: '#save', index: 2, note: 'Make it primary' }

test('draws in its own ignored shadow root, out of reach of the page and the picker', () => {
  const overlay = createOverlay()
  try {
    const host = document.documentElement.lastElementChild!
    expect(host.hasAttribute(VF_IGNORE_ATTR)).toBe(true)
    expect(host.getAttribute('aria-hidden')).toBe('true')
    expect(host.shadowRoot?.querySelector('style')?.textContent).toContain('.hover')
  } finally {
    overlay.destroy()
  }
})

test('a mark finds its element again after a re-render replaced it', () => {
  document.body.innerHTML = '<button id="save">Save</button>'
  const overlay = createOverlay()
  try {
    overlay.setMarks([mark])
    expect(overlay.markOf(document.getElementById('save')!)?.id).toBe('c1')
    document.body.innerHTML = '<button id="save">Save</button>'
    const fresh = document.getElementById('save')!
    expect(overlay.markOf(fresh)).toMatchObject({ id: 'c1', index: 2 })
    expect(overlay.markOf(document.body)).toBeNull()
  } finally {
    overlay.destroy()
  }
})

test('a selected area stays on its place in the document as the page scrolls', () => {
  const overlay = createOverlay()
  try {
    overlay.setActive({ area: { x: 10, y: 300, width: 200, height: 100 } })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 120 })
    expect(overlay.activeRect()).toMatchObject({ x: 10, y: 180, width: 200, height: 100 })
  } finally {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    overlay.destroy()
  }
})
