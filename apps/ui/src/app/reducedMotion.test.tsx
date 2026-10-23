import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Spinner } from '@localixai/kit/spinner'

describe('reduced-motion contracts', () => {
  it('keeps a stopped spinner understandable to assistive technology', () => {
    const html = renderToStaticMarkup(<Spinner label="Loading" />)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading"')
  })
})
