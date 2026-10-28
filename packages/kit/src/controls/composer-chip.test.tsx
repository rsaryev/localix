import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerChip } from './composer-chip'

describe('ComposerChip', () => {
  test('owns one native context-control geometry and safe button semantics', () => {
    const html = renderToStaticMarkup(<ComposerChip>Project</ComposerChip>)

    expect(html).toContain('<button')
    expect(html).toContain('data-slot="composer-chip"')
    expect(html).toContain('data-tone="default"')
    expect(html).toContain('type="button"')
    expect(html).toContain('h-[var(--chrome-control-md)]')
    expect(html).toContain('max-w-[14rem]')
    expect(html).toContain('rounded-full')
    expect(html).toContain('focus-ring')
    // The scroll-pill's glass material: the chip is its own trigger and holds still in a row.
    expect(html).toContain('lx-glass lx-glass-self')
    expect(html).toContain('disabled:opacity-50')
  })

  test('keeps strong and urgent states inside the same physical control', () => {
    const html = renderToStaticMarkup(
      <>
        <ComposerChip tone="strong">Isolated</ComposerChip>
        <ComposerChip tone="danger" aria-busy="true">
          Suggestions
        </ComposerChip>
      </>,
    )

    expect(html).toContain('data-tone="strong"')
    // The glass rim replaces the border, so tones speak through text colour only.
    expect(html).toContain('text-foreground')
    expect(html).toContain('data-tone="danger"')
    expect(html).toContain('text-status-error')
    expect(html).toContain('aria-busy="true"')
  })
})
