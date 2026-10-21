import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const actions = readFileSync(new URL('./ActionButtons.tsx', import.meta.url), 'utf8')

test('composer actions use the shared icon-action contract', () => {
  expect(actions).toContain("from '@localixai/kit/icon-button'")
  expect(actions).not.toMatch(/<button(?:\s|>)/)
  expect(actions).not.toContain('ComposerTip')
})
