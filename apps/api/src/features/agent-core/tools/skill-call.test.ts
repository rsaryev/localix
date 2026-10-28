import { describe, expect, test } from 'bun:test'

import { prepareSkillArguments, skillToolInputSchema } from './skill-call'

describe('Skill as Claude Code calls it', () => {
  test('{ skill, args } runs the skill with those arguments', () => {
    const input = skillToolInputSchema.parse(
      prepareSkillArguments({ skill: 'deploy-staging', args: '--dry-run' }),
    )
    expect(input).toEqual({ action: 'get', name: 'deploy-staging', arguments: '--dry-run' })
  })

  test('a plugin skill keeps its plugin:skill name', () => {
    const input = skillToolInputSchema.parse(prepareSkillArguments({ skill: 'ms-office:docx' }))
    expect(input).toEqual({ action: 'get', name: 'ms-office:docx' })
  })

  test('Localix’s own save is left as written', () => {
    const save = { action: 'save', name: 'x', description: 'd', content: 'c' }
    expect(prepareSkillArguments(save)).toEqual(save)
  })
})
