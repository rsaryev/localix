import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyState } from './EmptyState'

test('empty chat shows the Localix bird above the greeting', () => {
  const html = renderToStaticMarkup(<EmptyState />)

  expect(html).toContain('What would you like to accomplish?')
  expect(html).toContain('mask-image:url(/logo-dark.svg)')
  expect(html).toContain('wind-sweep')
  expect(html).toContain('text-2xl')
  expect(html).not.toContain('<svg')
  expect(html).not.toContain('fade-up')
  expect(html).not.toContain('text-3xl')
})

test('without a connection, points to the model menu instead of reading the environment', () => {
  const html = renderToStaticMarkup(<EmptyState hasConnection={false} />)

  expect(html).toContain('Connect a provider to start working.')
  expect(html).toContain('Pick a provider from the model menu below.')
})
