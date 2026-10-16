import { expect, test } from 'bun:test'
import { handlePluginCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'
import { sessionFixture } from '../../../testing/session-fixture'
import { noLeadership } from '../runtime/conversation-strategy'

const session = sessionFixture({ id: 'plugin-command', userId: 'u' })

function fixture(commandName: string) {
  const trace: string[] = []
  const replies: string[] = []
  const forbidden = () => {
    throw new Error('invalid command must not prepare or start a run')
  }
  const ctx = {
    now: () => {
      trace.push('now')
      return 'now'
    },
    repo: { listMessages: forbidden },
    runner: {
      leadership: () => {
        trace.push('leadership')
        return noLeadership
      },
    },
    gatherEnabledPluginCommands: async () => {
      trace.push('gather')
      return [
        {
          plugin: 'Fixture',
          pluginDir: '/fixture/plugin',
          command: {
            name: commandName,
            prompt: 'Deploy ${target}',
            args: [{ name: 'target', type: 'text', required: true }],
          },
        },
      ]
    },
    resolveSessionWorkingDir: forbidden,
    runMacroCommand: forbidden,
    insertDirectReply: async (_u: string, _s: string, _prompt: string, reply: string) => {
      trace.push('reply')
      replies.push(reply)
      return { sessionId: session.id, messageId: 'usage' }
    },
  } as unknown as CommandHandlerContext
  return { ctx, trace, replies }
}

test('a missing nested plugin-command argument returns usage before resolving files or starting a run', async () => {
  const f = fixture('sub:deploy')
  const result = await handlePluginCommand(f.ctx, 'u', session.id, session, '/FIXTURE:SUB:DEPLOY')
  expect(result).toEqual({ sessionId: session.id, messageId: 'usage' })
  expect(f.trace).toEqual(['now', 'gather', 'leadership', 'reply'])
  expect(f.replies[0]).toContain('Usage: `/Fixture:sub:deploy <target>`')
  expect(f.replies[0]).toContain('Missing required argument `target`')
})

test('a bare plugin token only claims a same-name command', async () => {
  const match = fixture('fixture')
  expect(await handlePluginCommand(match.ctx, 'u', session.id, session, '/fixture')).toEqual({
    sessionId: session.id,
    messageId: 'usage',
  })
  const other = fixture('deploy')
  expect(await handlePluginCommand(other.ctx, 'u', session.id, session, '/fixture')).toBeNull()
  expect(other.trace).toEqual(['now', 'gather'])
  expect(other.replies).toEqual([])
})

test('ordinary text reaches the next handler without loading plugin commands', async () => {
  const f = fixture('fixture')
  expect(await handlePluginCommand(f.ctx, 'u', session.id, session, 'plain text')).toBeNull()
  expect(f.trace).toEqual([])
})

test('a command that declares tools activates them for the chat before its run starts', async () => {
  const stored = ['web_fetch']
  const order: string[] = []
  const run = sessionFixture({ id: 'plugin-tools', userId: 'u' })
  const ctx = {
    now: () => 'now',
    deps: {},
    repo: {
      listMessages: async () => [],
      changeActivatedTools: async (
        _u: string,
        _s: string,
        change: (current: string[]) => { next: string[] } | null,
      ) => {
        order.push('activate')
        const changed = change(stored)
        if (changed) stored.splice(0, stored.length, ...changed.next)
        return changed
      },
    },
    runner: { leadership: () => noLeadership },
    gatherEnabledPluginCommands: async () => [
      {
        plugin: 'planner',
        pluginDir: '/fixture/planner',
        command: {
          name: 'planner',
          prompt: 'Plan ${goal}',
          args: [{ name: 'goal', type: 'text' }],
          activateTools: ['board'],
        },
      },
    ],
    resolveSessionWorkingDir: async () => '/work',
    runMacroCommand: async () => {
      order.push('run')
      expect(run.activatedTools).toEqual(['web_fetch', 'board'])
      return { sessionId: run.id, messageId: 'run' }
    },
    insertDirectReply: async () => {
      throw new Error('a valid command must not reply directly')
    },
  } as unknown as CommandHandlerContext
  await handlePluginCommand(ctx, 'u', run.id, run, '/planner ship it')
  expect(order).toEqual(['activate', 'run'])
  expect(stored).toEqual(['web_fetch', 'board'])
})
