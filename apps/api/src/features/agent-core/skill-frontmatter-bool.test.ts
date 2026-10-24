import { describe, expect, it } from 'bun:test'
import { parseSkillFrontmatter } from './skill-frontmatter'

// skills.md, frontmatter reference: "Boolean fields accept `yes`, `no`, `on`, `off`, `1`, and `0` in
// any letter case, in addition to `true` and `false`."
const skill = (fields: string) => `---\nname: deploy\n${fields}\n---\nDeploy it.\n`

describe('skill frontmatter booleans', () => {
  for (const yes of ['true', 'yes', 'On', '1']) {
    it(`disable-model-invocation: ${yes} keeps the model from running the skill`, () => {
      expect(
        parseSkillFrontmatter(skill(`disable-model-invocation: ${yes}`)).disableModelInvocation,
      ).toBe(true)
    })
  }

  for (const no of ['false', 'No', 'off', '0']) {
    it(`user-invocable: ${no} hides the skill from the person`, () => {
      expect(parseSkillFrontmatter(skill(`user-invocable: ${no}`)).userInvocable).toBe(false)
    })
  }

  it('an unreadable value leaves the default', () => {
    const fm = parseSkillFrontmatter(
      skill('user-invocable: maybe\ndisable-model-invocation: maybe'),
    )
    expect(fm.userInvocable).toBeUndefined()
    expect(fm.disableModelInvocation).toBeUndefined()
  })
})
