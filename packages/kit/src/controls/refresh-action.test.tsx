import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RefreshAction } from './refresh-action'

test('refresh action keeps one hit target and exposes progress without changing its label', () => {
  const idle = renderToStaticMarkup(
    <RefreshAction aria-label="Refresh schema" onClick={() => {}} />,
  )
  const busy = renderToStaticMarkup(
    <RefreshAction aria-label="Refresh schema" busy disabled onClick={() => {}} />,
  )

  expect(idle).toContain('aria-label="Refresh schema"')
  expect(idle).toContain('aria-busy="false"')
  expect(idle).toContain('--chrome-control-sm')
  expect(busy).toContain('aria-label="Refresh schema"')
  expect(busy).toContain('disabled')
  expect(busy).toContain('aria-busy="true"')
  expect(busy).toContain('data-state="working"')
})
