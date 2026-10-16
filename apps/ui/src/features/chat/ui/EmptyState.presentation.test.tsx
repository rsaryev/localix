import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyState } from './EmptyState'

test('empty chat shows only the flying Localix bird', () => {
  const html = renderToStaticMarkup(<EmptyState />)

  expect(html).not.toContain('What would you like to accomplish?')
  expect(html).not.toContain('<p')
  expect(html).toContain('mask-image:url(/logo-dark.svg)')
  expect(html).toContain('wind-sweep')
  expect(html).toContain('bird-drift')
  expect(html).toContain('infinite')
  expect(html).not.toContain('<svg')
  expect(html).not.toContain('fade-up')
  expect(html).not.toContain('text-3xl')
})
