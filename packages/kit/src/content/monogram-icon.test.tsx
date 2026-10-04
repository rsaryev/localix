import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { monogramIcon } from './monogram-icon'

describe('monogramIcon', () => {
  test('one component per identity and label, so a pick never remounts the tile', () => {
    expect(monogramIcon('reviewer', 'Reviewer')).toBe(monogramIcon('reviewer', 'Reviewer'))
    // A rename re-letters the tile, so it is a new component.
    expect(monogramIcon('reviewer', 'Diff Inspector')).not.toBe(
      monogramIcon('reviewer', 'Reviewer'),
    )
  })

  test('a 16px tile whose layout box is the 14px icon slot', () => {
    // The defect pinned: a bare 16px tile pushed its row's label 2px right of every glyph row and
    // spilled a pixel past each edge of the absolute indicator slot.
    const Icon = monogramIcon('implementer', 'Implementer')
    const html = renderToStaticMarkup(<Icon />)
    expect(html).toContain('width:16px')
    expect(html).toContain('height:16px')
    expect(html).toContain('-m-px')
  })
})
