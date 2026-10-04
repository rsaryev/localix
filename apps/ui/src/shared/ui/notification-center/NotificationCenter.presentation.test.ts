import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')
const center = read('./NotificationCenter.tsx')
const filterBar = read('./EventFilterBar.tsx')

describe('Event Center presentation', () => {
  test('uses one bounded header-and-journal layout', () => {
    expect(center).toContain('max-h-[min(42rem,var(--radix-popover-content-available-height))]')
    expect(center).toContain('shrink-0 border-b border-border-soft')
    expect(center).toContain('className="min-h-0 flex-1 overflow-y-auto py-1 scrollbar-thin"')
    expect(center).not.toContain('max-h-[min(62vh,32rem)]')
  })

  test('models scopes as pressed filters and reuses shared controls', () => {
    expect(filterBar).toContain('role="group" aria-label="Event status"')
    expect(filterBar).toContain('aria-pressed={active}')
    for (const source of [center, filterBar]) {
      expect(source).not.toContain('role="tablist"')
      expect(source).not.toContain('role="tab"')
      expect(source).not.toContain('aria-selected={active}')
      expect(source).not.toContain('focus-visible:ring-2 focus-visible:ring-ring/30')
    }
    expect(filterBar).toContain('<Button')
    expect(filterBar).toContain('<IconButton')
    // A narrowing is a pick: one shared filter menu, no framed selects inside the popover.
    expect(filterBar).toContain('<FilterMenu')
    expect(filterBar).not.toContain('<Select')
  })
})
