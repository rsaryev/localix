import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8')
const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split('}')[0]

test('reading bar uses sticky-layer tokens and reserves heading clearance', () => {
  const bar = rule('.docs-reading-bar')
  expect(bar).toContain('position: sticky')
  expect(bar).toContain('top: 0')
  expect(bar).toContain('z-index: var(--z-sticky)')
  expect(bar).toContain('background: var(--background)')
  expect(bar).toContain('align-items: center')
  expect(rule('.docs-prose :is(h1, h2, h3)')).toContain(
    'var(--chrome-control-touch) + var(--spacing) * 4',
  )
})

test('breadcrumbs avoid nested leading padding and fade only overflowing edges', () => {
  expect(rule('.docs-breadcrumb ol')).not.toContain('padding-inline:')
  expect(rule('.docs-breadcrumb')).toContain('mask-image:')
  expect(rule(".docs-breadcrumb[data-fade-left='true']")).toContain(
    '--crumb-fade-start: transparent',
  )
  expect(rule(".docs-breadcrumb[data-fade-right='true']")).toContain(
    '--crumb-fade-end: transparent',
  )
})
