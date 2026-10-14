import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('document status uses a semantic icon without a permanent status fill', () => {
  const source = readFileSync(new URL('./DocumentFileTab.tsx', import.meta.url), 'utf8')
  expect(source).toContain('<TriangleAlert')
  expect(source).not.toMatch(/bg-status-(?:error|warning|success)\/(?:5|10)\b/)
})
