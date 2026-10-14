import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./KubernetesNodeOverview.tsx', import.meta.url), 'utf8')

test('node facts use a flat overview section', () => {
  expect(source).toContain('border-y border-border-soft')
  expect(source).not.toContain('rounded-xl')
  expect(source).not.toContain('bg-surface-raised/40')
})
