import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { COMPOSER_CHIP, ComposerChip } from './composer-chip'

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
    expect(html).toContain('disabled:opacity-50')
  })

  test('is an ink fill on the window, with no outline as structure', () => {
    const classes = COMPOSER_CHIP.split(' ')
    // Rest, hover, pressed and open climb the shared ink steps.
    expect(classes).toEqual(
      expect.arrayContaining([
        'bg-field-fill',
        'hover:bg-surface-hover',
        'active:bg-surface-active',
        'aria-expanded:bg-surface-active',
        'data-[state=open]:bg-surface-active',
      ]),
    )
    // Not the floating pill's raised material, and no border or ring drawing the shape.
    expect(classes.some((c) => c.startsWith('lx-glass'))).toBe(false)
    expect(classes.some((c) => /^(?:border|ring)(?:-|$)/u.test(c))).toBe(false)
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
    // Tones speak through text colour only; the fill is the same for every tone.
    expect(html).toContain('text-foreground')
    expect(html).toContain('data-tone="danger"')
    expect(html).toContain('text-status-error')
    expect(html).toContain('aria-busy="true"')
  })
})
