import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./CreateTableDialog.tsx', import.meta.url), 'utf8')

test('create-table draft uses a flat empty SQL hint', () => {
  expect(source).toContain('<EmptyHint')
  expect(source).not.toContain(
    'h-20 items-center justify-center rounded-lg border border-border-soft bg-background',
  )
})
