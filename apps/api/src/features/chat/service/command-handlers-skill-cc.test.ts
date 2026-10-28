import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'

import { handleSkillCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'
import type { SkillRecord } from './skills'
import { routedAgent, sessionFixture } from '../../../testing/session-fixture'

/** A typed `/<plugin>:<skill>` against Claude Code's skills.md, one frontmatter field at a time. */
const session = sessionFixture({
  id: 's1',
  userId: 'u1',
  agent: routedAgent({ providerConnectionId: 'p1', modelId: 'gpt-4o' }),
})

const plugin = (name: string, extra: Partial<SkillRecord> = {}): SkillRecord => ({
  id: `plugin:cc:${name}`,
  name: `cc:${name}`,
  description: 'd',
  content: `BODY ${name}`,
  tags: [],
  projectId: '',
  scope: 'global',
  source: 'file',
  updatedAt: 'now',
  pluginName: 'cc',
  pluginDir: '/plugins/cc',
  path: `${tmpdir()}/SKILL.md`,
  ...extra,
})

function context(skill: SkillRecord) {
  const runs: Record<string, unknown>[] = []
  const forks: Record<string, unknown>[] = []
  const replies: string[] = []
  const ctx = {
    repo: { listMessages: async () => [] },
    runner: { isBusy: () => false, isRunning: () => false },
    now: () => 'now',
    gatherSessionSkills: async () => [],
    gatherEnabledPluginSkills: async () => [skill],
    loadSkillOverrides: async () => ({}),
    resolveSessionWorkingDir: async () => tmpdir(),
    runMacroCommand: async (...args: unknown[]) => {
      runs.push(args[7] as Record<string, unknown>)
      return { sessionId: 's1', messageId: 'a1' }
    },
    spawnForkSkill: async (...args: unknown[]) => {
      forks.push(args[3] as Record<string, unknown>)
      return 'child-session'
    },
    insertDirectReply: async (...args: unknown[]) => {
      replies.push(String(args[3]))
      return { sessionId: 's1', messageId: 'r1' }
    },
  } as unknown as CommandHandlerContext
  return { ctx, runs, forks, replies }
}

describe('a skill invoked as /<plugin>:<skill>', () => {
  // skills.md: "`model` | Model to use when this skill is active. The override applies for the
  // rest of the current turn".
  test('its model runs the invoking turn', async () => {
    const { ctx, runs } = context(plugin('fast', { preferredModel: 'gpt-4o-mini' }))
    await handleSkillCommand(ctx, 'u1', 's1', session, '/cc:fast')
    expect(runs[0]).toMatchObject({ modelId: 'gpt-4o-mini' })
  })

  // skills.md: "`effort` | Effort level when this skill is active. Overrides the session effort".
  test('its effort runs the invoking turn', async () => {
    const { ctx, runs } = context(plugin('deep', { preferredEffort: 'max' }))
    await handleSkillCommand(ctx, 'u1', 's1', session, '/cc:deep')
    expect(runs[0]).toMatchObject({ reasoningEffort: 'max' })
  })

  // hooks.md: skill hooks run for "the rest of the session once the skill is invoked".
  test('its hooks are registered for the rest of the session', async () => {
    const hooks = { PreToolUse: [{ hooks: [{ type: 'command', command: 'x' }] }] }
    const { ctx, runs } = context(plugin('guard', { hooks }))
    await handleSkillCommand(ctx, 'u1', 's1', session, '/cc:guard')
    expect(runs[0]).toMatchObject({
      ccScopedHooks: [{ raw: hooks, source: 'skill', lifetime: 'session' }],
    })
  })

  // skills.md: "Claude Code starts a new subagent of the type set in the `agent` field".
  test('context: fork with agent runs the fork as that subagent type', async () => {
    const forked = plugin('review', { contextFork: true, forkAgent: 'cc:reviewer' })
    const { ctx, forks, replies } = context(forked)
    await handleSkillCommand(ctx, 'u1', 's1', session, '/cc:review')
    expect(forks[0]).toMatchObject({ agent: 'cc:reviewer' })
    expect(replies[0]).not.toContain('no longer honoured')
  })

  // skills.md: "A failed command aborts the entire skill invocation ... Claude never sees the
  // skill content for that invocation. The abort shows `Shell command failed for pattern`".
  test('a failing injected command aborts it before the model is asked', async () => {
    const { ctx, runs, replies } = context(
      plugin('fail', { content: 'ABORT-BODY\n!`echo partial; exit 3`' }),
    )
    await handleSkillCommand(ctx, 'u1', 's1', session, '/cc:fail')
    expect(runs).toHaveLength(0)
    expect(replies[0]).toContain('Shell command failed for pattern "!`echo partial; exit 3`"')
    expect(replies[0]).toContain('partial')
    expect(replies[0]).not.toContain('ABORT-BODY')
  })

  // skills.md: arguments are inserted into the content, which a ```! block's command then runs.
  test('an injected command receives the arguments, and they are not appended again', async () => {
    const { ctx, runs } = context(plugin('args', { content: 'got: !`printf "[%s]" $ARGUMENTS`' }))
    const calls: string[] = []
    const capture = {
      ...ctx,
      runMacroCommand: async (...args: unknown[]) => {
        calls.push(String(args[5]))
        runs.push({})
        return { sessionId: 's1', messageId: 'a1' }
      },
    } as unknown as CommandHandlerContext
    await handleSkillCommand(capture, 'u1', 's1', session, '/cc:args Polish "the README"')
    expect(calls).toEqual(['got: [Polish][the README]'])
  })
})
