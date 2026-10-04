import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const actions = readFileSync(new URL('./ActionButtons.tsx', import.meta.url), 'utf8')
const prompt = readFileSync(new URL('./PromptInput.tsx', import.meta.url), 'utf8')

test('prompt improvement completion uses one flat check signal', () => {
  expect(actions).toContain('didImproveRecently')
  expect(actions).toContain('text-status-success')
  expect(actions).not.toContain('bg-status-success/10')
  expect(prompt).not.toContain('var(--status-success)')
})

test('composer actions use the shared icon-action contract', () => {
  expect(actions).toContain("from '@localixai/kit/icon-button'")
  expect(actions).not.toMatch(/<button(?:\s|>)/)
  expect(actions).not.toContain('ComposerTip')
})
