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

// sub-agents.md, "Preload skills into subagents": "You can't preload skills that set
// `disable-model-invocation: true`"; "up to the first 32 distinct names in the list"; a plugin
// skill is named `<plugin>:<name>`.
describe('skills an agent file preloads', () => {
  const skill = (name: string, extra: Partial<DiscoveredSkill> = {}) =>
    ({
      name,
      description: 'd',
      content: `Body ${name}`,
      scope: 'global',
      path: `/s/${name}/SKILL.md`,
      dir: `/s/${name}`,
      ...extra,
    }) as DiscoveredSkill

  test('leave out a user-only skill, stop at 32 names, and find a plugin skill by its full name', () => {
    const all = [
      skill('manual', { disableModelInvocation: true }),
      skill('lookup', { pluginName: 'kit' }),
      ...Array.from({ length: 40 }, (_, i) => skill(`s${i}`)),
    ]
    const names = ['manual', 'kit:lookup', ...Array.from({ length: 40 }, (_, i) => `s${i}`)]
    const out = resolvePinnedSkills(all, names, {}, { preload: true }).map((s) => s.name)
    expect(out).not.toContain('manual')
    expect(out[0]).toBe('kit:lookup')
    expect(out).toHaveLength(31)
    // A pin the person made is an explicit invocation and keeps its user-only skill.
    expect(resolvePinnedSkills(all, ['manual']).map((s) => s.name)).toEqual(['manual'])
  })
})
