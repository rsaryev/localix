import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownImg } from './MarkdownImage'

describe('a Markdown image', () => {
  test('opens full size from a button named after its alt text', () => {
    const html = renderToStaticMarkup(<MarkdownImg src="assets/logo.png" alt="Logo" width={40} />)
    expect(html).toContain('aria-label="Open image: Logo full size"')
    expect(html).toContain('src="assets/logo.png"')
    expect(html).toContain('width="40"')
    expect(html).toContain('loading="lazy"')
  })

  test('without a source it reads as its alt text, or as nothing', () => {
    expect(renderToStaticMarkup(<MarkdownImg alt="Logo" />)).toBe(
      '<span class="text-text-faint">Logo</span>',
    )
    expect(renderToStaticMarkup(<MarkdownImg />)).toBe('')
  })
})
