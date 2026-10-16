import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./EnginePicker.tsx', import.meta.url), 'utf8')

describe('database engine picker presentation', () => {
  test('uses one flat IDE list instead of engine cards', () => {
    expect(source).toContain('divide-y divide-border-faint border-y border-border-faint')
    expect(source).toContain('hover:bg-surface-hover/60')
    expect(source).not.toContain('grid grid-cols-1 gap-1.5 @xl:grid-cols-2')
    expect(source).not.toContain('rounded-lg border border-border-soft bg-surface-raised/25')
    expect(source).not.toContain('rounded-lg bg-surface-hover')
  })

  test('the locked dialect wears the kit field recipe, not a transcribed copy of it', () => {
    expect(source).toContain('FIELD_SURFACE,')
    expect(source).not.toMatch(/className="[^"]*border-control-border/)
    expect(source).not.toMatch(/className="[^"]*bg-foreground\/\[0\.04\]/)
  })
})
