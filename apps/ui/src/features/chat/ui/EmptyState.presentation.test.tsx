import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyState } from './EmptyState'

test('empty chat shows only the still Localix bird', () => {
  const html = renderToStaticMarkup(<EmptyState />)

  expect(html).not.toContain('What would you like to accomplish?')
  expect(html).not.toContain('<p')
  expect(html).toContain('mask-image:url(/logo-dark.svg)')
  expect(html).not.toContain('wind-sweep')
  expect(html).not.toContain('bird-drift')
  expect(html).not.toContain('<svg')
  expect(html).not.toContain('fade-up')
  expect(html).not.toContain('text-3xl')
})

test('without a connection, points to the model menu instead of reading the environment', () => {
  const html = renderToStaticMarkup(<EmptyState hasConnection={false} />)

  expect(html).toContain('Pick a provider from the model menu below.')
})
