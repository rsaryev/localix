import { expect, test } from 'bun:test'
import { namesSkill } from './runtime-tool-instances'

// skills.md: "After plain text, as a separate word with no punctuation attached".
test('a skill is named by /name as its own word', () => {
  expect(namesSkill('go ahead and /deploy to staging', 'deploy')).toBe(true)
  expect(namesSkill('/kit:ship now', 'kit:ship')).toBe(true)
  expect(namesSkill('see /deploy, then', 'deploy')).toBe(false)
  expect(namesSkill('the deploy step', 'deploy')).toBe(false)
  expect(namesSkill(undefined, 'deploy')).toBe(false)
})
