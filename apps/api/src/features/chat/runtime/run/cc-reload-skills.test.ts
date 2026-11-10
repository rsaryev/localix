/**
 * hooks.md, "Reload skills that a hook installs": with `reloadSkills`, a skill a SessionStart hook
 * wrote reaches this session; a listing frozen before it was written leaves the agent a note.
 */
import { expect, test } from 'bun:test'
import type { ChatSkill } from '../../../plugins/kit'
import { reloadedSkillsNote } from './cc-reload-skills'

const skill = (name: string, more: Partial<ChatSkill> = {}) =>
  ({
    name,
    description: `About ${name}`,
    modelInvocable: true,
    dormant: false,
    ...more,
  }) as ChatSkill

test('names the skills the frozen listing lacks, and only those Claude may load', () => {
  const skills = [skill('review'), skill('deploy'), skill('quiet', { modelInvocable: false })]
  expect(reloadedSkillsNote(skills, '- review: About review')).toBe(
    'Skills a SessionStart hook installed, available with the Skill tool:\n- deploy: About deploy',
  )
  expect(reloadedSkillsNote(skills, '- review: About review\n- deploy')).toBeUndefined()
})
