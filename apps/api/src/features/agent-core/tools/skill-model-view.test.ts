import { describe, expect, test } from 'bun:test'
import { createSkillTool } from './skill'
import type { SkillToolPorts } from './skill-call'
import { testSkillPorts } from '../testing/skill-ports'

/**
 * The model's view of a skill through the tool, as Claude Code gives it: the body as the host ran
 * it. Which skill a name calls is the kit session's (`chat/runtime/run/skill-tool-ports.ts`).
 */
const run = (tool: ReturnType<typeof createSkillTool>, input: Record<string, unknown>) =>
  tool.execute('t', input as never)

const pluginSkill = { name: 'zzrn:zz-render', ownName: 'zz-render', content: 'zzrn-BODY' }
const toolWith = (more: SkillToolPorts) =>
  createSkillTool(null, {}, '', undefined, testSkillPorts([pluginSkill], more))

const textOf = (result: Awaited<ReturnType<typeof run>>) =>
  typeof result.content === 'string' ? result.content : JSON.stringify(result.content)

describe('skill tool — the model’s view', () => {
  // skills.md: "When you or Claude invoke a skill, the rendered SKILL.md content enters the
  // conversation"; "Both you and Claude can pass arguments when invoking a skill".
  test('get returns the rendered body, with the arguments it was asked with', async () => {
    const seen: string[] = []
    const tool = toolWith({
      invokeSkill: async (skill, request) => {
        seen.push(request.arguments)
        return { ok: true, text: `RENDERED ${skill.content} ${request.arguments}` }
      },
    })
    const got = await run(tool, { action: 'get', name: 'zzrn:zz-render', arguments: 'a b' })
    expect(textOf(got)).toContain('RENDERED zzrn-BODY a b')
    expect(textOf(got)).toContain('# Skill: zzrn:zz-render')
    expect(seen).toEqual(['a b'])
  })

  // skills.md: "A failed command aborts the entire skill invocation ... Claude never sees the
  // skill content for that invocation."
  test('a run that fails refuses the load with its message', async () => {
    const tool = toolWith({
      invokeSkill: async () => ({
        ok: false,
        message: 'Shell command failed for pattern "!`exit 3`": [exit code 3]',
      }),
    })
    const got = await run(tool, { action: 'get', name: 'zzrn:zz-render' })
    expect(got.isError).toBe(true)
    expect(textOf(got)).toContain('Shell command failed for pattern "!`exit 3`"')
    expect(textOf(got)).not.toContain('zzrn-BODY')
  })
})
