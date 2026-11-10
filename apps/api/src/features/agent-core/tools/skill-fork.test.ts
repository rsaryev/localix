import { describe, expect, test } from 'bun:test'
import { testSkillPorts } from '../testing/skill-ports'
import { createSkillTool, type SkillForkRequest, type SkillRun } from './skill'

// skills.md, "Run skills in a subagent": with `context: fork` "Claude Code starts a new subagent of
// the type set in the `agent` field and gives it the skill content as its prompt". Which agent,
// whether the call waits and the fork's model and effort are the host's expansion
// (`plugins/kit/skills.ts`); the tool hands them to the subagent port as they come.
const skill = {
  name: 'zz-fork-research',
  content: 'Research $ARGUMENTS thoroughly.',
  path: '/p/.claude/skills/zz-fork-research/SKILL.md',
  dir: '/p/.claude/skills/zz-fork-research',
}

describe('a context: fork skill the agent loads', () => {
  test('runs in the subagent the expansion names, with its task, model and effort', async () => {
    const asked: SkillForkRequest[] = []
    const run: SkillRun = {
      ok: true,
      text: 'Research auth thoroughly.',
      fork: { agent: 'Explore', wait: true, model: 'haiku', effort: 'low' },
    }
    const tool = createSkillTool(
      null,
      {},
      '',
      undefined,
      testSkillPorts([skill], {
        invokeSkill: async () => run,
        forkSkill: async (_id, request) => (asked.push(request), { content: 'the report' }),
      }),
    )
    const got = await tool.execute('call-1', {
      action: 'get',
      name: 'zz-fork-research',
      arguments: 'auth',
    })
    expect(asked).toEqual([
      {
        title: '/zz-fork-research auth',
        task: 'Research auth thoroughly.',
        agent: 'Explore',
        wait: true,
        model: 'haiku',
        effort: 'low',
      },
    ])
    expect(String(got.content)).toContain('the report')
    expect(String(got.content)).not.toContain('# Skill: zz-fork-research\nSource')
  })
})

// skills.md, "Where you write the skill's name": `go ahead and /deploy to staging` — "The name
// counts as your permission for that message". The tool tells the host whether the person named it.
describe('a skill named in the person’s message', () => {
  test('the host is told the person named it, and its refusal is the result', async () => {
    const named: boolean[] = []
    const tool = (userNamed: boolean) =>
      createSkillTool(
        null,
        {},
        '',
        undefined,
        testSkillPorts([skill], {
          userNamed: () => userNamed,
          invokeSkill: async (_skill, request): Promise<SkillRun> => {
            named.push(request.named)
            return request.named ? { ok: true, text: 'go' } : { ok: false, message: 'user only' }
          },
        }),
      )
    const get = { action: 'get', name: 'zz-fork-research' } as const
    expect((await tool(true).execute('c', get)).isError).toBeUndefined()
    const refused = await tool(false).execute('c', get)
    expect(refused.isError).toBe(true)
    expect(String(refused.content)).toContain('user only')
    expect(named).toEqual([true, false])
  })
})
