import { describe, expect, test } from 'bun:test'
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Input } from './input'

describe('Input geometry', () => {
  test('names every density after its rung on the shared physical control scale', () => {
    const md = renderToStaticMarkup(<Input aria-label="Default input" />)
    const lg = renderToStaticMarkup(<Input aria-label="Form input" size="lg" />)
    const xl = renderToStaticMarkup(<Input aria-label="Decision input" size="xl" />)

    // The same name means the same pixels as on a Button: md 28, lg 32, xl 36.
    expect(md).toContain('h-[var(--chrome-control-md)]')
    expect(lg).toContain('h-[var(--chrome-control-lg)]')
    expect(xl).toContain('h-[var(--chrome-control-xl)]')
    expect(xl).toContain('text-sm')
    for (const html of [md, lg, xl]) {
      expect(html).toContain('data-slot="input"')
      expect(html).toContain('focus-visible:ring-control-border-focus')
    }
  })

  test('accepts a native input ref for focus-owning surfaces', () => {
    const ref = createRef<HTMLInputElement>()
    expect(() => renderToStaticMarkup(<Input ref={ref} aria-label="Filter value" />)).not.toThrow()
  })

  test('distinguishes read-only content without disabling selection', () => {
    const html = renderToStaticMarkup(
      <Input readOnly defaultValue="Generated value" aria-label="Generated value" />,
    )

    expect(html).toContain('read-only:cursor-not-allowed')
    // A thinner veil than the editable fill, NOT `surface-sunken`: sunken is a black 45% veil
    // under the glass theme, which on a field-sized control read as a black slot.
    expect(html).toContain('read-only:bg-foreground/[0.02]')
    expect(html).not.toContain('read-only:bg-surface-sunken')
    expect(html).toContain('readOnly=""')
    expect(html).not.toContain('disabled=""')
  })
})
