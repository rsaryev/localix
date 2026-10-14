import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Skeleton } from './skeleton'

test('loading geometry remains decorative while the parent announces its status', () => {
  const markup = renderToStaticMarkup(
    <section aria-busy="true" aria-label="Document">
      <p role="status">Loading document</p>
      <Skeleton aria-hidden={false} />
      <Skeleton />
    </section>,
  )
  expect(markup.match(/role="status"/g)).toHaveLength(1)
  expect(markup.match(/aria-hidden="true"/g)).toHaveLength(2)
  expect(markup).not.toContain('aria-hidden="false"')
})
