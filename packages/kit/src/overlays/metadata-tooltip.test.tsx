import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MetadataTooltip } from './tooltip'

test('MetadataTooltip preserves passive DOM and never invents a tab stop', () => {
  const html = renderToStaticMarkup(
    <MetadataTooltip label="Background job — completed">
      <span role="status" aria-label="completed">
        BG
      </span>
    </MetadataTooltip>,
  )

  expect(html).toContain('data-tooltip-trigger="true"')
  expect(html).toContain('role="status"')
  expect(html).toContain('aria-label="completed"')
  expect(html).not.toContain('tabindex=')
  expect(html).not.toContain('title=')
})
