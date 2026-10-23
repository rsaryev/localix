import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { tonedIcon } from './toned-icon'

const Glyph = ({ className }: { className?: string }) => createElement('svg', { className })

describe('tonedIcon', () => {
  test('returns the same component for the same icon and tone, so a row never remounts', () => {
    expect(tonedIcon(Glyph, 'warning')).toBe(tonedIcon(Glyph, 'warning'))
    expect(tonedIcon(Glyph, 'warning')).not.toBe(tonedIcon(Glyph, 'error'))
  })

  test("paints the tone's status token and keeps the host's classes and attributes", () => {
    const Toned = tonedIcon(Glyph, 'error')
    const html = renderToStaticMarkup(createElement(Toned, { className: 'size-3' }))
    expect(html).toContain('text-status-error size-3')
    expect(renderToStaticMarkup(createElement(tonedIcon(Glyph, 'neutral')))).toContain(
      'text-text-soft',
    )
  })
})
