import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./ConnectionInput.tsx', import.meta.url), 'utf8')

describe('database connection form presentation', () => {
  test('keeps informational modes as flat form sections', () => {
    expect(source.match(/border-y border-border-faint py-2\.5/g)).toHaveLength(2)
    expect(source).not.toContain('rounded-md border border-border-soft bg-surface-raised/35')
    expect(source).not.toContain('rounded-md border border-border-soft bg-surface-raised/20')
  })
})
