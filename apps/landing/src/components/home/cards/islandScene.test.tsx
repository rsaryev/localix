import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { HOMEPAGE_HIGHLIGHTS } from '../../../pages/homeHighlights'
import { IslandScene } from './islandScene'

test('the island card grows from the notch over the menu bar of another app', () => {
  const markup = renderToStaticMarkup(<IslandScene />)
  expect(markup.indexOf('sc-menubar')).toBeLessThan(markup.indexOf('sc-island'))
  expect(markup.indexOf('sc-island-card')).toBeLessThan(markup.indexOf('sc-notch'))
  expect(markup).toContain('sc-island-pick')
  expect(markup).toContain('is-warm')
})

test('wide cards keep every three-column row full', () => {
  const units = HOMEPAGE_HIGHLIGHTS.reduce((sum, card) => sum + (card.wide ? 2 : 1), 0)
  expect(units % 3).toBe(0)
})
