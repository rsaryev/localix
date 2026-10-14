import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./DevOpsWorkspace.tsx', import.meta.url), 'utf8')

describe('DevOps workspace chrome', () => {
  test('uses the canonical compact workspace header measure', () => {
    expect(source).toContain('<WorkbenchToolbar as="header"')
    expect(source).not.toContain('border-b border-border-soft px-3 py-2')
  })
})
