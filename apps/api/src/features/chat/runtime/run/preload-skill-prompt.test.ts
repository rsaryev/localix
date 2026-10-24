import { expect, test } from 'bun:test'
import { hostWithMod } from '../../../mods/testing/testing-host'
import { preloadedSkillsThroughMods } from './preload-skill-prompt'

// claude-code types, `SkillPromptInput`: `skill.prompt` fires for a skill "typed as `/name`, run by
// the Skill tool, or preloaded into a subagent (named there as its agent wrote it)".
test('a preloaded skill’s text goes through skill.prompt', async () => {
  const { scope } = await hostWithMod((on) => {
    on('skill.prompt', { skill: 'kit:lint' }, ($, e: any) => ({ text: `${e.text} Strictly.` }))
  })
  const out = await preloadedSkillsThroughMods(
    [
      { name: 'kit:lint', content: 'Lint it.' },
      { name: 'other', content: 'As is.' },
    ],
    scope,
  )
  expect(out).toEqual([
    { name: 'kit:lint', content: 'Lint it. Strictly.' },
    { name: 'other', content: 'As is.' },
  ])
})
