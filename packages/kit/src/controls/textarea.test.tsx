import { describe, expect, test } from 'bun:test'
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Textarea } from './textarea'

describe('Textarea foundation', () => {
  test('maps authoring density onto the settings text scale', () => {
    const html = renderToStaticMarkup(<Textarea size="xl" aria-label="Instructions" />)
    expect(html).toContain('data-slot="textarea"')
    expect(html).toContain('px-3')
    expect(html).toContain('py-2.5')
    expect(html).toContain('text-sm')
    expect(html).toContain('focus-visible:ring-control-border-focus')
    expect(html).toContain('focus-visible:ring-inset')
    expect(html).toContain('aria-invalid:border-destructive')
  })

  test('grows within a bounded surface and distinguishes read-only content', () => {
    const html = renderToStaticMarkup(
      <Textarea readOnly defaultValue="Generated instructions" aria-label="Instructions" />,
    )

    expect(html).toContain('field-sizing-content')
    expect(html).toContain('max-h-[10lh]')
    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('scrollbar-thin')
    // A thinner veil than the editable fill, NOT `surface-sunken`: sunken is a black 45% veil
    // under the glass theme, which on a field-sized control read as a black slot.
    expect(html).toContain('read-only:bg-foreground/[0.02]')
    expect(html).not.toContain('read-only:bg-surface-sunken')
    expect(html).toContain('readOnly=""')
  })

  test('accepts a native textarea ref for focus-owning forms', () => {
    const ref = createRef<HTMLTextAreaElement>()
    expect(() =>
      renderToStaticMarkup(<Textarea ref={ref} aria-label="Instructions" />),
    ).not.toThrow()
  })
})
