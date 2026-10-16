import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./ConnectForm.tsx', import.meta.url), 'utf8')

describe('database connection workspace chrome', () => {
  test('keeps the selected engine header transparent and compact', () => {
    expect(source).toContain('border-b border-border-soft px-4 py-2.5')
    expect(source).toContain(
      "'flex size-7 shrink-0 items-center justify-center text-2xs font-semibold'",
    )
    expect(source).not.toContain('bg-surface-raised/15')
    expect(source).not.toContain('size-9 shrink-0 items-center justify-center rounded-lg')
  })

  test('the footer paints no second ground over the pane', () => {
    // Under glass `--background` carries alpha, so a footer coat compounds into a darker band.
    expect(source).toContain('"shrink-0 border-t border-border-soft px-4 py-2.5 @2xl:px-6"')
    expect(source).not.toMatch(/className="[^"]*\bbg-background\b/)
  })
})
