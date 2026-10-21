import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

test('command and secret details avoid nested card surfaces and stacked rules', () => {
  const confirm = read('./ConfirmInteractionView.tsx')
  const secret = read('./SecretInteractionView.tsx')
  const surfaces = [confirm, secret].join('\n')

  // The frame already draws ONE rule — the seam above the footer. A bordered detail
  // block put a second rule ~20px above it, so the card read as a stack of lines.
  expect(surfaces).not.toContain('border-y border-control-border/40')
  expect(surfaces).not.toContain('rounded-lg bg-surface-hover p-2.5')
})
