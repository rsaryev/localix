import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DialogHero } from './dialog-hero'

describe('DialogHero', () => {
  test('is decoration: hidden from assistive technology, toned by what the dialog does', () => {
    const html = renderToStaticMarkup(<DialogHero tone="danger" icon={<svg />} />)
    expect(html).toStartWith('<div aria-hidden="true" data-slot="dialog-hero"')
    expect(html).toContain('data-size="sm"')
    expect(html).toContain('data-tone="danger"')
    expect(html).toContain('lx-hero-ring-fill')
  })

  test('a header mark draws no stage: sparks and children belong to `lg` only', () => {
    const under = <span className="under" />
    const small = renderToStaticMarkup(<DialogHero icon={<svg />}>{under}</DialogHero>)
    expect(small).not.toContain('lx-hero-spark')
    expect(small).not.toContain('under')

    const large = renderToStaticMarkup(
      <DialogHero size="lg" icon={<svg />} badge={<svg />}>
        {under}
      </DialogHero>,
    )
    expect(large).toContain('lx-hero-spark')
    expect(large).toContain('class="under"')
    expect(large).toContain('lx-hero-badge')
  })
})
