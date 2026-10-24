import { describe, expect, test } from 'bun:test'
import type { DiscoveredSkill } from '../skill-discovery'
import { parseSkillFrontmatter } from '../skill-frontmatter'
import { createSkillTool, type SkillForkRequest } from './skill'

// skills.md, "Run skills in a subagent": with `context: fork` "Claude Code starts a new subagent of
// the type set in the `agent` field and gives it the skill content as its prompt" — whether you or
// Claude invoke the skill. `background: false` waits for the result in the invoking turn; `model`
// and `effort` set the forked subagent's.
const forked = (frontmatter: string): DiscoveredSkill =>
  ({
    ...(parseSkillFrontmatter(
      `---\n${frontmatter}\n---\nResearch $ARGUMENTS thoroughly.`,
    ) as object),
    name: 'deep-research',
    description: 'Research a topic',
    content: 'Research $ARGUMENTS thoroughly.',
    scope: 'project',
    path: '/p/.localix/skills/deep-research/SKILL.md',
    dir: '/p/.localix/skills/deep-research',
  }) as DiscoveredSkill

describe('a context: fork skill the agent loads', () => {
  test('runs in a subagent of its agent type with its model and effort', async () => {
    const asked: SkillForkRequest[] = []
    const skill = forked(
      'context: fork\nagent: Explore\nmodel: haiku\neffort: low\nbackground: false',
    )
    const tool = createSkillTool(
      null,
      [skill],
      {},
      '',
      undefined,
      undefined,
      async (s, args) => s.content.replace('$ARGUMENTS', args),
      { forkSkill: async (_id, request) => (asked.push(request), { content: 'the report' }) },
    )
    const got = await tool.execute('call-1', {
      action: 'get',
      name: 'deep-research',
      arguments: 'auth',
    })
    expect(asked).toEqual([
      {
        title: '/deep-research auth',
        task: 'Research auth thoroughly.',
        agent: 'Explore',
        wait: true,
        model: 'haiku',
        effort: 'low',
      },
    ])
    expect(String(got.content)).toContain('the report')
    expect(String(got.content)).not.toContain('# Skill: deep-research\nSource')
  })

  test('runs in the background unless background: false', async () => {
    const asked: SkillForkRequest[] = []
    const tool = createSkillTool(
      null,
      [forked('context: fork')],
      {},
      '',
      undefined,
      undefined,
      undefined,
      {
        forkSkill: async (_id, request) => (asked.push(request), { content: 'started' }),
      },
    )
    await tool.execute('c', { action: 'get', name: 'deep-research' })
    expect(asked[0]).toEqual(expect.objectContaining({ wait: false }))
    expect(asked[0]).not.toHaveProperty('agent')
  })
})
