import { describe, expect, test } from 'bun:test'
import { tempDirPerTest } from '@localixai/testing'
import { createSkillTool } from './skill'
import { writeSkillFile, type DiscoveredSkill } from '../skill-discovery'

const project = tempDirPerTest('skill-model-view-')

/**
 * The model's view of a skill through the tool, as Claude Code gives it: a plugin skill by its
 * `/<plugin>:<name>`, a `disable-model-invocation` skill refused, and the body rendered.
 */
const run = (tool: ReturnType<typeof createSkillTool>, input: Record<string, unknown>) =>
  tool.execute('t', input as never)

const pluginSkill = (plugin: string, name: string, extra: Partial<DiscoveredSkill> = {}) =>
  ({
    name,
    description: `${plugin}-DESC`,
    content: `${plugin}-BODY`,
    scope: 'global',
    path: `/p/${plugin}/skills/${name}/SKILL.md`,
    dir: `/p/${plugin}/skills/${name}`,
    pluginName: plugin,
    ...extra,
  }) as DiscoveredSkill

const textOf = (result: Awaited<ReturnType<typeof run>>) =>
  typeof result.content === 'string' ? result.content : JSON.stringify(result.content)

describe('skill tool — the model’s view', () => {
  test('two plugins’ skills of one name stay two, each by its namespaced name', async () => {
    const tool = createSkillTool(null, [
      pluginSkill('zzqa', 'zz-lookup'),
      pluginSkill('zzqb', 'zz-lookup'),
    ])
    const listed = textOf(await run(tool, { action: 'list' }))
    expect(listed).toContain('- /zzqa:zz-lookup (global): zzqa-DESC')
    expect(listed).toContain('- /zzqb:zz-lookup (global): zzqb-DESC')
    const second = await run(tool, { action: 'get', name: 'zzqb:zz-lookup' })
    expect(textOf(second)).toContain('zzqb-BODY')
    expect(textOf(second)).toContain('# Skill: zzqb:zz-lookup')
  })

  // skills.md: "If Claude tries anyway, Claude Code blocks the call and instructs it not to
  // reproduce the deploy steps another way"; "Description not in context".
  test('a disable-model-invocation skill is refused and left out of the list', async () => {
    const tool = createSkillTool(null, [
      pluginSkill('zzdm', 'zz-secret', { disableModelInvocation: true }),
    ])
    const got = await run(tool, { action: 'get', name: 'zzdm:zz-secret' })
    expect(got.isError).toBe(true)
    expect(textOf(got)).not.toContain('zzdm-BODY')
    expect(textOf(got)).toContain('only be run by the user as /zzdm:zz-secret')
    expect(textOf(await run(tool, { action: 'list' }))).not.toContain('zzdm-DESC')
  })

  // skills.md: "When you or Claude invoke a skill, the rendered SKILL.md content enters the
  // conversation"; "Both you and Claude can pass arguments when invoking a skill".
  test('get returns the rendered body, with the arguments it was asked with', async () => {
    const seen: string[] = []
    const tool = createSkillTool(
      null,
      [pluginSkill('zzrn', 'zz-render')],
      {},
      '',
      undefined,
      undefined,
      async (skill, args) => {
        seen.push(args)
        return `RENDERED ${skill.content} ${args}`
      },
    )
    const got = await run(tool, { action: 'get', name: 'zzrn:zz-render', arguments: 'a b' })
    expect(textOf(got)).toContain('RENDERED zzrn-BODY a b')
    expect(seen).toEqual(['a b'])
  })

  // skills.md: "A failed command aborts the entire skill invocation ... Claude never sees the
  // skill content for that invocation."
  test('a render that fails refuses the load with its message, and loads nothing', async () => {
    let loaded = 0
    const tool = createSkillTool(
      null,
      [pluginSkill('zzfl', 'zz-fail')],
      {},
      '',
      undefined,
      () => loaded++,
      async () => {
        throw new Error('Shell command failed for pattern "!`exit 3`": [exit code 3]')
      },
    )
    const got = await run(tool, { action: 'get', name: 'zzfl:zz-fail' })
    expect(got.isError).toBe(true)
    expect(textOf(got)).toContain('Shell command failed for pattern "!`exit 3`"')
    expect(textOf(got)).not.toContain('zzfl-BODY')
    expect(loaded).toBe(0)
  })

  // The defect: matching a bare name first, over a list sorted by call name, handed `get lookup`
  // the plugin's `aplug:lookup` while `/lookup (project)` was listed beside it.
  test('a bare name is the project skill of that name, not a plugin skill sharing it', async () => {
    await writeSkillFile(
      project(),
      { name: 'zz-lookup', description: 'own', content: 'OWN-BODY' },
      'project',
    )
    const tool = createSkillTool(project(), [pluginSkill('aplug', 'zz-lookup')])
    const own = textOf(await run(tool, { action: 'get', name: 'zz-lookup' }))
    expect(own).toContain('OWN-BODY')
    expect(own).toContain('# Skill: zz-lookup\n')
    expect(textOf(await run(tool, { action: 'get', name: 'aplug:zz-lookup' }))).toContain(
      'aplug-BODY',
    )
  })

  test('a bare name two plugins share is ambiguous, not whichever sorts first', async () => {
    const tool = createSkillTool(null, [
      pluginSkill('zzpa', 'zz-shared'),
      pluginSkill('zzpb', 'zz-shared'),
    ])
    const got = await run(tool, { action: 'get', name: 'zz-shared' })
    expect(got.isError).toBe(true)
    expect(textOf(got)).toContain('ambiguous: /zzpa:zz-shared, /zzpb:zz-shared')
    const one = createSkillTool(null, [pluginSkill('zzpa', 'zz-single')])
    expect(textOf(await run(one, { action: 'get', name: 'zz-single' }))).toContain('zzpa-BODY')
  })
})
