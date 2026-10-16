import { describe, expect, test } from 'bun:test'

import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
import { resolvePinnedSkills } from './prompt-pinned-skills'

function skill(name: string, content: string, disableModelInvocation = false): DiscoveredSkill {
  return {
    name,
    description: `${name} description`,
    content,
    scope: 'project',
    path: `/skills/${name}/SKILL.md`,
    dir: `/skills/${name}`,
    ...(disableModelInvocation ? { disableModelInvocation: true } : {}),
  }
}

describe('resolvePinnedSkills', () => {
  test('treats a pin as explicit invocation even when model invocation is disabled', () => {
    const [resolved] = resolvePinnedSkills([skill('deploy', 'explicit body', true)], ['deploy'])
    expect(resolved.name).toBe('deploy')
    expect(resolved.content).toContain('Resolve relative references from: "/skills/deploy"')
    expect(resolved.content).toEndWith('explicit body')
  })

  test('preserves configured order, ignores missing names, and deduplicates pins', () => {
    const skills = [skill('alpha', 'A'), skill('beta', 'B')]
    const resolved = resolvePinnedSkills(skills, ['beta', 'missing', 'alpha', 'beta'])
    expect(resolved.map((entry) => entry.name)).toEqual(['beta', 'alpha'])
    expect(resolved.map((entry) => entry.content.split('\n').at(-1))).toEqual(['B', 'A'])
  })

  test('omits an explicitly pinned skill when the user override is off', () => {
    expect(
      resolvePinnedSkills(
        [skill('enabled', 'A'), skill('disabled', 'B')],
        ['disabled', 'enabled'],
        {
          disabled: 'off',
        },
      ),
    ).toEqual([expect.objectContaining({ name: 'enabled' })])
  })

  test('omits a stale lazy pin instead of aborting prompt preparation', () => {
    const stale = skill('stale', 'unused')
    Object.defineProperty(stale, 'content', {
      get: () => {
        throw new Error('file disappeared')
      },
    })

    expect(resolvePinnedSkills([stale, skill('healthy', 'body')], ['stale', 'healthy'])).toEqual([
      expect.objectContaining({ name: 'healthy' }),
    ])
  })
})
