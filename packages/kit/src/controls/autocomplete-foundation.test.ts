import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const primitive = readFileSync(new URL('./autocomplete.tsx', import.meta.url), 'utf8')

describe('autocomplete foundation', () => {
  test('owns portal placement, listbox semantics, and input-focus retention centrally', () => {
    expect(primitive).toContain('<PopoverContent')
    expect(primitive).toContain('w-(--radix-popover-trigger-width)')
    expect(primitive).toContain('var(--radix-popover-content-available-height)')
    expect(primitive).toContain('role="listbox"')
    expect(primitive.match(/event\.preventDefault\(\)/g)?.length).toBeGreaterThanOrEqual(6)
    expect(primitive).toContain('onOpenAutoFocus')
    expect(primitive).toContain('onCloseAutoFocus')
    expect(primitive).toContain('aria-selected={active}')
    expect(primitive).toContain('tabIndex={-1}')
    expect(primitive).toContain('ref={ref}')
    expect(primitive).toContain("AutocompleteList.displayName = 'AutocompleteList'")
  })

  test('separates rich completion chrome from one explicit scrolling body', () => {
    expect(primitive).toContain('data-slot="autocomplete-panel"')
    expect(primitive).toContain('layout="structured"')
    expect(primitive).toContain('data-slot="autocomplete-header"')
    expect(primitive).toContain('data-slot="autocomplete-body"')
    expect(primitive).toContain('data-slot="autocomplete-options"')
    expect(primitive).toContain('overflow-y-auto overscroll-contain')
    expect(primitive).toContain(
      'max-h-[min(50vh,22rem,var(--radix-popover-content-available-height))]',
    )
  })
})
