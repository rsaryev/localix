import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { registerDom } from '../testing/dom'
import { SectionHeading } from './section-heading'

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

describe('SectionHeading', () => {
  test('names a page with a level-2 heading unless told otherwise', () => {
    const host = render(<SectionHeading title="Sources" />)
    expect(host.querySelector('h2')?.textContent).toBe('Sources')
  })

  test('the heading element is chosen apart from how large it is drawn', () => {
    const asPane = render(<SectionHeading title="Store" as="h1" level="section" />)
    expect(asPane.querySelector('h1')?.textContent).toBe('Store')
    const asPart = render(<SectionHeading title="Collections" level="section" as="h2" />)
    expect(asPart.querySelector('h2')?.textContent).toBe('Collections')
    const byDefault = render(<SectionHeading title="Part" level="section" />)
    expect(byDefault.querySelector('h3')?.textContent).toBe('Part')
  })

  test('a page and a section of the same heading element are drawn at different sizes', () => {
    const page = render(<SectionHeading title="A" as="h2" />).querySelector('h2')!
    const section = render(<SectionHeading title="A" as="h2" level="section" />).querySelector(
      'h2',
    )!
    expect(page.className).not.toBe(section.className)
  })

  test('shows its description under the title, and its actions after both', () => {
    const host = render(
      <SectionHeading
        title="Sources"
        description="Where the Store finds what it offers."
        actions={<button type="button">Add source…</button>}
      />,
    )
    const text = host.textContent ?? ''
    expect(text.indexOf('Sources')).toBeLessThan(text.indexOf('Where the Store'))
    expect(text.indexOf('Where the Store')).toBeLessThan(text.indexOf('Add source…'))
    expect(host.querySelector('button')?.textContent).toBe('Add source…')
  })

  test('draws no empty description or actions slot', () => {
    const host = render(<SectionHeading title="Plain" />)
    expect(host.querySelector('[data-slot="section-heading-description"]')).toBeNull()
    expect(host.querySelector('[data-slot="section-heading-actions"]')).toBeNull()
  })

  test('a caller can add layout classes to the header', () => {
    const host = render(<SectionHeading title="Plain" className="mb-4" />)
    expect(host.querySelector('header')?.classList.contains('mb-4')).toBe(true)
  })
})
