import { describe, expect, test } from 'bun:test'

import { resolveTriggeredSkills } from './prompt-skill-triggers'
import type { DiscoveredSkill } from '../../agent-core/skill-discovery'

const skill = (name: string, keywords?: string[]): DiscoveredSkill =>
  ({
    name,
    description: name,
    content: `procedure for ${name}`,
    scope: 'project',
    path: `/repo/.localix/skills/${name}/SKILL.md`,
    dir: `/repo/.localix/skills/${name}`,
    ...(keywords ? { keywords } : {}),
  }) as DiscoveredSkill

describe('keyword-triggered skills', () => {
  test('a keyword in the message forces the skill in', () => {
    const out = resolveTriggeredSkills([skill('deploy-guide', ['deploy'])], 'please deploy the app')
    expect(out.map((s) => s.name)).toEqual(['deploy-guide'])
    expect(out[0]!.keyword).toBe('deploy')
    // Full content, not a listing entry: the point is that the model does not have to choose
    // to retrieve it. Relative references resolve against the skill's own directory.
    expect(out[0]!.content).toContain('procedure for deploy-guide')
    expect(out[0]!.content).toContain('/repo/.localix/skills/deploy-guide')
  })

  test('a skill without keywords is never triggered', () => {
    expect(resolveTriggeredSkills([skill('quiet')], 'deploy deploy deploy')).toEqual([])
  })

  test('matching is case-insensitive', () => {
    expect(resolveTriggeredSkills([skill('s', ['Rollback'])], 'time to ROLLBACK')).toHaveLength(1)
  })

  test('word boundaries, so a short keyword cannot fire from inside a longer word', () => {
    // The surprise an author cannot see coming. Someone who wants the longer forms lists them.
    expect(resolveTriggeredSkills([skill('s', ['cat'])], 'concatenate the files')).toEqual([])
    expect(resolveTriggeredSkills([skill('s', ['cat'])], 'the cat sat')).toHaveLength(1)
  })

  test('a phrase matches across any run of whitespace', () => {
    // A line break in the user's message must not decide whether their procedure applies.
    const skills = [skill('s', ['deploy to prod'])]
    expect(resolveTriggeredSkills(skills, 'we should deploy to prod today')).toHaveLength(1)
    expect(resolveTriggeredSkills(skills, 'we should deploy\n  to   prod today')).toHaveLength(1)
    expect(resolveTriggeredSkills(skills, 'deploy to staging')).toEqual([])
  })

  test('a keyword ending in punctuation still matches', () => {
    // `\b` would never fire here, which would be a silently dead keyword.
    expect(resolveTriggeredSkills([skill('s', ['c++'])], 'rewrite it in c++ please')).toHaveLength(
      1,
    )
  })

  test('a pinned skill is not injected twice', () => {
    // Its content is already in the cached prefix; a second copy just spends the budget.
    const out = resolveTriggeredSkills([skill('deploy-guide', ['deploy'])], 'deploy', [
      'deploy-guide',
    ])
    expect(out).toEqual([])
  })

  test('one skill fires once, on its first matching keyword', () => {
    const out = resolveTriggeredSkills([skill('s', ['deploy', 'ship'])], 'deploy and ship')
    expect(out).toHaveLength(1)
    expect(out[0]!.keyword).toBe('deploy')
  })

  test('an empty or missing message triggers nothing', () => {
    const skills = [skill('s', ['deploy'])]
    expect(resolveTriggeredSkills(skills, '   ')).toEqual([])
    expect(resolveTriggeredSkills(skills, undefined)).toEqual([])
  })

  test('a keyword made of regex metacharacters is matched literally', () => {
    // Author-supplied prose, so it must not be able to compile into a pattern.
    expect(resolveTriggeredSkills([skill('s', ['a.b'])], 'axb')).toEqual([])
    expect(resolveTriggeredSkills([skill('s', ['a.b'])], 'a.b')).toHaveLength(1)
  })
})
