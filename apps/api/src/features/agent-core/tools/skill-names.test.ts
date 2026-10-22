import { expect, test } from 'bun:test'
import type { DiscoveredSkill } from '../skill-frontmatter'
import { findSkillByName, skillCallName } from './skill-names'

const skill = (name: string, dir: string, pluginName?: string): DiscoveredSkill => ({
  name,
  description: '',
  content: '',
  scope: 'global',
  path: `${dir}/SKILL.md`,
  dir,
  ...(pluginName ? { pluginName } : {}),
})

const writing = skill('writing-hookify-rules', '/p/hookify/skills/writing-rules', 'hookify')
const own = skill('deploy', '/home/.localix/skills/deploy')

test('a plugin skill is called <plugin>:<name>, and a prefixed name is not prefixed again', () => {
  expect(skillCallName(writing)).toBe('hookify:writing-hookify-rules')
  expect(skillCallName(skill('hookify:x', '/p/x', 'hookify'))).toBe('hookify:x')
  expect(skillCallName(own)).toBe('deploy')
})

test('hookify’s command finds its skill by <plugin>:<folder>, as well as by its names', () => {
  const skills = [own, writing]
  expect(findSkillByName(skills, 'hookify:writing-rules')).toBe(writing)
  expect(findSkillByName(skills, 'hookify:writing-hookify-rules')).toBe(writing)
  expect(findSkillByName(skills, 'writing-hookify-rules')).toBe(writing)
  expect(findSkillByName(skills, '/deploy')).toBe(own)
  // A folder name alone does not reach a plugin skill: another plugin's could share it.
  expect(findSkillByName(skills, 'writing-rules')).toBeUndefined()
})
