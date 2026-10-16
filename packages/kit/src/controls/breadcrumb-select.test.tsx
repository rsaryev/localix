import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BreadcrumbSelect, type BreadcrumbSelectItem } from './breadcrumb-select'

const items: BreadcrumbSelectItem[] = [
  { id: 'a', label: 'Alpha', onSelect: () => {}, active: false },
  { id: 'b', label: 'Bravo', onSelect: () => {}, active: true },
]

describe('BreadcrumbSelect', () => {
  test('renders the trigger with the active-level label and aria-label', () => {
    const html = renderToStaticMarkup(
      <BreadcrumbSelect label="Bravo" items={items} ariaLabel="Switch thing" />,
    )
    expect(html).toContain('Bravo')
    expect(html).toContain('aria-label="Switch thing"')
    // A chevron affordance is always present on the segment trigger.
    expect(html).toContain('<svg')
  })

  test('applies caller trigger classes (width caps / emphasis)', () => {
    const html = renderToStaticMarkup(
      <BreadcrumbSelect
        label="X"
        items={items}
        ariaLabel="X"
        className="max-w-[14rem] text-foreground"
      />,
    )
    expect(html).toContain('max-w-[14rem]')
    expect(html).toContain('text-foreground')
  })

  test('can identify the current hierarchy destination', () => {
    const html = renderToStaticMarkup(
      <BreadcrumbSelect
        label="Current chat"
        items={items}
        ariaLabel="Switch session"
        ariaCurrent="page"
      />,
    )

    expect(html).toContain('aria-current="page"')
  })
})
