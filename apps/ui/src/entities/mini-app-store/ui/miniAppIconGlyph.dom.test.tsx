import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

describe('a mini app’s icon on the rail', () => {
  test('is its own icon, drawn at the size the rail gives its glyphs', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { miniAppIconGlyph } = await import('./miniAppIconGlyph')
    const Glyph = miniAppIconGlyph('/rpc/mini-apps/chess/icon?v=1.0.0')
    expect(miniAppIconGlyph('/rpc/mini-apps/chess/icon?v=1.0.0')).toBe(Glyph)
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<Glyph className="size-4" />))
    const img = host.querySelector('img')!
    expect(img.getAttribute('src')).toEndWith('/rpc/mini-apps/chess/icon?v=1.0.0')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.className).toContain('size-6')
    await act(async () => root.unmount())
  })
})
