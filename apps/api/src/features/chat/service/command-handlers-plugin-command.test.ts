import { expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { handlePluginCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'
import { sessionFixture } from '../../../testing/session-fixture'
import { noLeadership } from '../runtime/conversation-strategy'
import { workflowCommand } from '../../plugins/workflow-commands'

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
    gatherEnabledPluginSkills: async () => [],
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
    gatherEnabledPluginSkills: async () => [],
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

test('a plugin workflow runs as its command: the workflow tool is activated and asked for', async () => {
  const run = sessionFixture({ id: 'plugin-workflow', userId: 'u' })
  let instruction = ''
  const ctx = {
    now: () => 'now',
    deps: {},
    repo: {
      listMessages: async () => [],
      changeActivatedTools: async (
        _u: string,
        _s: string,
        change: (current: string[]) => { next: string[] } | null,
      ) => change([]),
    },
    runner: { leadership: () => noLeadership },
    gatherEnabledPluginSkills: async () => [],
    gatherEnabledPluginCommands: async () => [
      {
        plugin: 'acme',
        pluginDir: '/fixture/acme',
        command: workflowCommand('acme', {
          name: 'release-audit',
          description: 'Audit the release',
          file: '/fixture/acme/workflows/audit.js',
        }),
      },
    ],
    resolveSessionWorkingDir: async () => '/work',
    runMacroCommand: async (...args: unknown[]) => {
      instruction = String(args[5])
      return { sessionId: run.id, messageId: 'run' }
    },
    insertDirectReply: async () => {
      throw new Error('a valid command must not reply directly')
    },
  } as unknown as CommandHandlerContext
  await handlePluginCommand(ctx, 'u', run.id, run, '/acme:release-audit 1024, 1025')
  expect(run.activatedTools).toEqual(['workflow'])
  expect(instruction).toContain('`acme:release-audit` now with the `workflow` tool')
  expect(instruction).toContain('Input: 1024, 1025')
})

function dupCtx(prompt: string, skills: unknown[], replies: string[], runs: string[]) {
  return {
    now: () => 'now',
    deps: {},
    repo: { listMessages: async () => [] },
    runner: { leadership: () => noLeadership },
    gatherEnabledPluginSkills: async () => skills,
    gatherEnabledPluginCommands: async () => [
      { plugin: 'dup', pluginDir: tmpdir(), command: { name: 'review', prompt, args: [] } },
    ],
    resolveSessionWorkingDir: async () => tmpdir(),
    runMacroCommand: async (...args: unknown[]) => {
      runs.push(String(args[5]))
      return { sessionId: session.id, messageId: 'run' }
    },
    insertDirectReply: async (_u: string, _s: string, _p: string, reply: string) => {
      replies.push(reply)
      return { sessionId: session.id, messageId: 'reply' }
    },
  } as unknown as CommandHandlerContext
}

// skills.md, "Resolve skills that share a name": "A skill and a file in `.claude/commands/` | The
// skill". The command steps aside; the skill handler, later in the dispatch, runs the skill.
test('a plugin command steps aside for a same-name skill of its plugin', async () => {
  const runs: string[] = []
  const skill = { name: 'dup:review', pluginName: 'dup' }
  const ctx = dupCtx('DUP-COMMAND', [skill], [], runs)
  expect(await handlePluginCommand(ctx, 'u', session.id, session, '/dup:review')).toBeNull()
  const modelOnly = dupCtx('DUP-COMMAND', [{ ...skill, userInvocable: false }], [], runs)
  await handlePluginCommand(modelOnly, 'u', session.id, session, '/dup:review')
  expect(runs).toEqual(['DUP-COMMAND'])
})

// skills.md: "A failed command aborts the entire skill invocation ... The abort shows `Shell
// command failed for pattern "..."`. The error message includes the command's output."
test('a failing injected command aborts the plugin command before the model is asked', async () => {
  const replies: string[] = []
  const runs: string[] = []
  const ctx = dupCtx('BODY\n!`echo partial; exit 3`', [], replies, runs)
  await handlePluginCommand(ctx, 'u', session.id, session, '/dup:review')
  expect(runs).toEqual([])
  expect(replies[0]).toContain('Shell command failed for pattern "!`echo partial; exit 3`"')
  expect(replies[0]).toContain('partial')
})

// The official ralph-loop command runs `"${CLAUDE_PLUGIN_ROOT}/setup.sh" $ARGUMENTS` in a ```!
// block: the arguments reach the script, each as one word, and are not appended again.
test('an injected command receives the arguments as shell words', async () => {
  const runs: string[] = []
  const ctx = dupCtx('```!\nprintf "[%s]" $ARGUMENTS\n```', [], [], runs)
  await handlePluginCommand(ctx, 'u', session.id, session, '/dup:review Polish "the README" $(id)')
  expect(runs).toEqual(['[Polish][the README][$(id)]'])
})
