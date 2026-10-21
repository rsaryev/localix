import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelFilterMenu } from './ModelFilterMenu'
import { modelCountLabel } from './filterModels'

describe('model filter menu', () => {
  test('is one icon trigger on the search band, pressed and named by what it filters', () => {
    const html = renderToStaticMarkup(
      <ModelFilterMenu
        available={['vision', 'tools', 'reasoning']}
        active={['vision', 'tools']}
        onToggle={() => {}}
        onClear={() => {}}
      />,
    )

    expect(html).toContain('aria-pressed="true"')
    // Canonical facet order, not click order: the label reads the same whatever was picked first.
    expect(html).toContain('aria-label="Filtered: Tools, Vision"')
    expect(html).toContain('lucide-list-filter')
    // No strip of its own: the facets live in the menu, not as a band of toggles.
    expect(html).not.toContain('data-slot="workbench-toolbar"')
  })

  test('reads as an unpressed "Filter models" with nothing active', () => {
    const html = renderToStaticMarkup(
      <ModelFilterMenu available={['tools']} active={[]} onToggle={() => {}} onClear={() => {}} />,
    )
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-label="Filter models"')
  })

  test('renders nothing when no facet applies to the list', () => {
    expect(
      renderToStaticMarkup(
        <ModelFilterMenu available={[]} active={[]} onToggle={() => {}} onClear={() => {}} />,
      ),
    ).toBe('')
  })
})

describe('model count label', () => {
  test('says the total alone until search or a filter hides some', () => {
    expect(modelCountLabel(12, 12)).toBe('12')
    expect(modelCountLabel(4, 12)).toBe('4 of 12')
    expect(modelCountLabel(0, 12)).toBe('0 of 12')
  })
})
