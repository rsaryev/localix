import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { registerDom } from '../testing/dom'
import { SectionLabel } from './section-label'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})

const render = (node: React.ReactElement) => {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(node)
  return host
}

describe('SectionLabel', () => {
  test('is plain text by default, not a heading', () => {
    const host = render(<SectionLabel>Filters</SectionLabel>)
    expect(host.textContent).toBe('Filters')
    expect(host.querySelector('h2, h3, h4')).toBeNull()
  })

  test('can be the heading of the group it labels', () => {
    expect(
      render(<SectionLabel as="h3">Reaches</SectionLabel>).querySelector('h3')?.textContent,
    ).toBe('Reaches')
    expect(render(<SectionLabel as="h4">Reaches</SectionLabel>).querySelector('h4')).not.toBeNull()
  })
})
