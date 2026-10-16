import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocalixBorderBeam } from './localix-border-beam'

test('LocalixBorderBeam is decorative and exposes reusable state attributes', () => {
  const html = renderToStaticMarkup(<LocalixBorderBeam active variant="working" intensity={5} />)

  expect(html).toContain('aria-hidden="true"')
  expect(html).toContain('data-active="true"')
  expect(html).toContain('data-variant="working"')
  expect(html).toContain('data-intensity="5"')
  expect(html).toContain('lx-border-beam')
  expect(html).not.toContain('data-still')
})

test('a still beam is marked so CSS stops its per-frame turn', () => {
  const html = renderToStaticMarkup(<LocalixBorderBeam active intensity={3} still />)

  expect(html).toContain('data-active="true"')
  expect(html).toContain('data-still="true"')
})
