import { describe, expect, test } from 'bun:test'

import { handleSkillCommand } from './command-handlers'
import { handleSkillsControlCommand } from './command-handlers-listings'
import type { CommandHandlerContext } from './command-handlers-context'
import type { SessionRecord } from '../repository'
import type { SkillRecord } from './skills'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { noLeadership } from '../runtime/conversation-strategy'

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
      loadSkillOverrides: async () => ({ 'sample-skill': 'off' as const }),
      runMacroCommand: () => {
        throw new Error('must not run')
      },
    } as unknown as CommandHandlerContext

    expect(await handleSkillCommand(ctx, 'u1', 's1', session, '/sample-skill')).toBeNull()
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
