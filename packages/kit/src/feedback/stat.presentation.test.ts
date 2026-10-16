import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./stat.tsx', import.meta.url), 'utf8')

describe('dashboard statistics presentation', () => {
  test('uses quiet rules instead of raised cards', () => {
    expect(source).toContain('border-t border-border-soft px-1 py-3')
    expect(source).toContain('border-y border-border-soft py-4')
    expect(source).not.toContain('rounded-xl')
    expect(source).not.toContain('bg-surface-raised')
  })

  test('does not carry decorative animation timing through the component API', () => {
    expect(source).not.toContain('delay')
    expect(source).not.toContain('fade-up')
  })
})
