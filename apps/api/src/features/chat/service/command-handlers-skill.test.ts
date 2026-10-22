import { describe, expect, test } from 'bun:test'

import { handleSkillCommand } from './command-handlers'
import { handleSkillsControlCommand } from './command-handlers-listings'
import type { CommandHandlerContext } from './command-handlers-context'
import type { SessionRecord } from '../repository'
import type { SkillRecord } from './skills'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { noLeadership } from '../runtime/conversation-strategy'
import { pluginDataDir } from '../../plugins/mcp'
import { userHome } from '../../../lib/env'

const session: SessionRecord = sessionFixture({
  id: 's1',
  userId: 'u1',
  title: 'test',
  agents: routedParticipants({
    providerConnectionId: 'p1',
    modelId: 'model',
    reasoningEffort: 'low',
  }),
  createdAt: 'now',
  updatedAt: 'now',
  lastMessageAt: 'now',
  rootSessionId: null,
})

const skill: SkillRecord = {
  id: 'db:sample-skill',
  name: 'sample-skill',
  description: 'Sample skill',
  content: 'Handle $ARGUMENTS carefully.',
  tags: [],
  projectId: '',
  scope: 'global',
  source: 'db',
  updatedAt: 'now',
}

describe('handleSkillCommand', () => {
  test('links /name to a one-run hidden instruction without pinning the session', async () => {
    const macroCalls: unknown[][] = []
    const ctx = {
      repo: { listMessages: async () => [] },
      runner: { isBusy: () => false, isRunning: () => false, leadership: () => noLeadership },
      now: () => 'now',
      gatherSessionSkills: async () => [skill],
      loadSkillOverrides: async () => ({}),
      resolveSessionWorkingDir: async () => '/repo',
      runMacroCommand: async (...args: unknown[]) => {
        macroCalls.push(args)
        return { sessionId: 's1', messageId: 'a1' }
      },
      insertDirectReply: async () => ({ sessionId: 's1', messageId: 'a1' }),
    } as unknown as CommandHandlerContext

    const result = await handleSkillCommand(ctx, 'u1', 's1', session, '/sample-skill auth flow')

    expect(result).toEqual({ sessionId: 's1', messageId: 'a1' })
    expect(macroCalls).toHaveLength(1)
    expect(macroCalls[0]?.[4]).toBe('/sample-skill auth flow')
    expect(macroCalls[0]?.[5]).toBe('Handle auth flow carefully.')
    expect(session.pinnedSkills).toEqual([])
  })

  test('reports a model-only skill accurately instead of calling it unknown', async () => {
    const replies: string[] = []
    const ctx = {
      repo: {
        listMessages: async () => {
          throw new Error('direct replies must not hydrate the transcript')
        },
      },
      runner: { isBusy: () => false, isRunning: () => false, leadership: () => noLeadership },
      now: () => 'now',
      gatherSessionSkills: async () => [{ ...skill, userInvocable: false }],
      loadSkillOverrides: async () => ({}),
      insertDirectReply: async (...args: unknown[]) => {
        replies.push(String(args[3]))
        return { sessionId: 's1', messageId: 'a1' }
      },
    } as unknown as CommandHandlerContext

    const result = await handleSkillCommand(ctx, 'u1', 's1', session, '/sample-skill')

    expect(result).toEqual({ sessionId: 's1', messageId: 'a1' })
    expect(replies).toEqual([
      'Skill `/sample-skill` is model-only (`user-invocable: false`) and cannot be run as a slash command.',
    ])
  })

  test('reports a lazy skill read failure without starting an agent run', async () => {
    const replies: string[] = []
    const stale = { ...skill }
    Object.defineProperty(stale, 'content', {
      get: () => {
        throw new Error('SKILL.md changed during read')
      },
    })
    const ctx = {
      repo: { listMessages: async () => [] },
      runner: { isBusy: () => false, isRunning: () => false, leadership: () => noLeadership },
      now: () => 'now',
      gatherSessionSkills: async () => [stale],
      loadSkillOverrides: async () => ({}),
      resolveSessionWorkingDir: async () => '/repo',
      runMacroCommand: () => {
        throw new Error('must not run')
      },
      insertDirectReply: async (...args: unknown[]) => {
        replies.push(String(args[3]))
        return { sessionId: 's1', messageId: 'a1' }
      },
    } as unknown as CommandHandlerContext

    expect(await handleSkillCommand(ctx, 'u1', 's1', session, '/sample-skill')).toEqual({
      sessionId: 's1',
      messageId: 'a1',
    })
    expect(replies[0]).toContain('could not be loaded')
    expect(replies[0]).toContain('changed during read')
  })

  test('treats an off skill as unavailable and never starts an agent run', async () => {
    const ctx = {
      gatherSessionSkills: async () => [skill],
      gatherEnabledPluginSkills: async () => [],
      loadSkillOverrides: async () => ({ 'sample-skill': 'off' as const }),
      runMacroCommand: () => {
        throw new Error('must not run')
      },
    } as unknown as CommandHandlerContext

    expect(await handleSkillCommand(ctx, 'u1', 's1', session, '/sample-skill')).toBeNull()
  })
})

const pluginSkill = (plugin: string, name: string): SkillRecord => ({
  ...skill,
  id: `plugin:${plugin}:${name}`,
  name: `${plugin}:${name}`,
  content: `Plugin ${plugin} handles $ARGUMENTS.`,
  source: 'file',
  pluginName: plugin,
  pluginDir: `/plugins/${plugin}`,
})

function pluginCtx(plugins: SkillRecord[], macroCalls: unknown[][]) {
  return {
    repo: { listMessages: async () => [] },
    runner: { isBusy: () => false, isRunning: () => false, leadership: () => noLeadership },
    now: () => 'now',
    gatherSessionSkills: async () => [skill],
    gatherEnabledPluginSkills: async () => plugins,
    loadSkillOverrides: async () => ({}),
    resolveSessionWorkingDir: async () => '/repo',
    runMacroCommand: async (...args: unknown[]) => {
      macroCalls.push(args)
      return { sessionId: 's1', messageId: 'a1' }
    },
    insertDirectReply: async () => ({ sessionId: 's1', messageId: 'a1' }),
  } as unknown as CommandHandlerContext
}

describe('plugin skills run as /<plugin>:<skill>', () => {
  test('the namespaced name runs the plugin skill with its arguments', async () => {
    const calls: unknown[][] = []
    const ctx = pluginCtx([pluginSkill('kit', 'review')], calls)

    await handleSkillCommand(ctx, 'u1', 's1', session, '/kit:review the auth flow')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[5]).toBe('Plugin kit handles the auth flow.')
    expect(calls[0]?.[7]).toMatchObject({
      invocation: {
        invocation: { kind: 'skill', name: 'kit:review', arguments: 'the auth flow' },
        presentation: { label: '/kit:review', token: '/kit:review' },
      },
    })
  })

  test('the bare name runs it when one plugin has it, and nothing guesses between two', async () => {
    const calls: unknown[][] = []
    const one = pluginCtx([pluginSkill('kit', 'review')], calls)
    await handleSkillCommand(one, 'u1', 's1', session, '/review now')
    expect(calls[0]?.[5]).toBe('Plugin kit handles now.')

    const two = pluginCtx([pluginSkill('kit', 'review'), pluginSkill('other', 'review')], calls)
    expect(await handleSkillCommand(two, 'u1', 's1', session, '/review now')).toBeNull()
    expect(calls).toHaveLength(1)
  })

  test("its frontmatter hooks carry the plugin's root and data dir, inline and forked", async () => {
    const hooks = { PreToolUse: [{ hooks: [{ type: 'command', command: 'x' }] }] }
    const plugin = {
      name: 'kit',
      root: '/plugins/kit',
      dataDir: pluginDataDir('kit', userHome()),
    }
    const calls: unknown[][] = []
    await handleSkillCommand(
      pluginCtx([{ ...pluginSkill('kit', 'review'), hooks }], calls),
      'u1',
      's1',
      session,
      '/kit:review',
    )
    expect(calls[0]?.[7]).toMatchObject({
      ccScopedHooks: [{ raw: hooks, source: 'skill', plugin }],
    })

    const forks: unknown[] = []
    const forkCtx = {
      ...pluginCtx([{ ...pluginSkill('kit', 'review'), hooks, contextFork: true }], calls),
      spawnForkSkill: async (...args: unknown[]) => {
        forks.push(args[3])
        return 'child-session'
      },
    } as unknown as CommandHandlerContext
    await handleSkillCommand(forkCtx, 'u1', 's1', session, '/kit:review')
    expect(forks[0]).toMatchObject({ hooks, hooksPlugin: plugin })
  })

  test("the person's own skill keeps its bare name over a plugin's", async () => {
    const calls: unknown[][] = []
    const ctx = pluginCtx([pluginSkill('kit', 'sample-skill')], calls)
    await handleSkillCommand(ctx, 'u1', 's1', session, '/sample-skill x')
    expect(calls[0]?.[5]).toBe('Handle x carefully.')
  })
})

describe('handleSkillsControlCommand', () => {
  test('does not reveal skills whose override is off', async () => {
    const replies: string[] = []
    await handleSkillsControlCommand(
      {
        gatherSessionSkills: async () => [skill, { ...skill, name: 'enabled' }],
        loadSkillOverrides: async () => ({ 'sample-skill': 'off' }),
      },
      'u1',
      session,
      async (reply) => {
        replies.push(reply)
        return { sessionId: 's1', messageId: 'a1' }
      },
    )

    expect(replies[0]).toContain('/enabled')
    expect(replies[0]).not.toContain('/sample-skill')
    expect(replies[0]).not.toContain('[off]')
  })
})
