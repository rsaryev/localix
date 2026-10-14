import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./PortForwardDialogView.tsx', import.meta.url), 'utf8')

test('recommended port metadata uses a flat semantic mark', () => {
  expect(source).toContain('<CheckCircle2')
  expect(source).toContain('Recommended')
  expect(source).not.toContain('<Chip')
  expect(source).not.toContain("from '@localixai/kit/chip'")
  expect(source).not.toContain('rounded-lg bg-surface-raised/45')
  expect(source).not.toContain('rounded-lg bg-background/70')
})
