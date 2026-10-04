import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./TechnicalsTab.tsx', import.meta.url), 'utf8')

describe('TechnicalsTab presentation', () => {
  test('uses flat IDE sections for ratings and analysis lenses', () => {
    expect(source).toContain('border-y border-border-faint')
    expect(source).not.toContain('rounded-md border border-border-soft bg-surface-raised/20')
    expect(source).not.toContain('border-b border-border-soft bg-surface-raised/30')
  })
})
