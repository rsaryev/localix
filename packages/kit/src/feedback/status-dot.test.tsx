import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { StatusDot } from './status-dot'

test('StatusDot exposes labelled state through managed metadata hover', () => {
  const html = renderToStaticMarkup(<StatusDot label="Running" className="bg-status-success" />)

  expect(html).toContain('role="status"')
  expect(html).toContain('aria-label="Running"')
  expect(html).toContain('data-tooltip-trigger="true"')
  expect(html).not.toContain('title=')
  expect(html).not.toContain('tabindex=')
})
